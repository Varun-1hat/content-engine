import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { v2 as cloudinary } from 'cloudinary';
import { pipeline } from 'stream/promises';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

let resolvedFfmpegPath = ffmpegStatic as string;
if (resolvedFfmpegPath && resolvedFfmpegPath.includes('ROOT')) {
  resolvedFfmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
}
if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

export async function POST(req: Request) {
  let tempDir = '';
  try {
    const { avatarVideoUrl, brollPlan } = await req.json();

    if (!avatarVideoUrl || !brollPlan) {
      return NextResponse.json({ error: 'Missing avatarVideoUrl or brollPlan' }, { status: 400 });
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-assembly-'));
    
    // 1. Download Avatar Video safely using streams to prevent memory crash
    const avatarPath = path.join(tempDir, 'avatar.mp4');
    const avatarRes = await fetch(avatarVideoUrl);
    if (!avatarRes.ok || !avatarRes.body) throw new Error('Failed to download avatar video');
    
    // Polyfill for streaming response body to file
    const fileStream = fs.createWriteStream(avatarPath);
    const reader = avatarRes.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(value);
    }
    fileStream.end();

    // Wait for the file to be fully written
    await new Promise<void>(resolve => fileStream.on('finish', () => resolve()));

    // 2. Prepare B-roll URLs
    const brolls = Array.isArray(brollPlan) ? brollPlan : (brollPlan.broll || []);
    const outputPath = path.join(tempDir, 'final_output.mp4');
    
    // GENERATE B-ROLLS WITH VEO 3.1 IN PARALLEL VIA PYTHON SCRIPT
    const downloadedBrolls: any[] = [];
    if (brolls.length > 0) {
        console.log("Starting Google Veo 3.1 parallel generation...");
        
        await Promise.all(brolls.map(async (b: any, index: number) => {
            let localPath = '';
            try {
                const isImage = b.media_type === "image";
                const ext = isImage ? ".jpg" : ".mp4";
                const scriptFile = isImage ? "imagen_generator.py" : "veo_generator.py";
                const aiModelName = isImage ? "Imagen 3" : "Veo 3.1";
                
                console.log(`Sending ${aiModelName} Task: ${b.veo_prompt || b.prompt}`);
                const brollPath = path.join(tempDir, `broll_${index}${ext}`);
                const scriptPath = path.join(process.cwd(), 'src', 'lib', scriptFile);
                
                // Encode arguments in Base64 to completely bypass Windows terminal escaping bugs
                const base64Prompt = Buffer.from(b.veo_prompt || b.prompt || "").toString('base64');
                const base64Neg = Buffer.from(b.negative_prompt || "").toString('base64');
                
                const cmd = `python "${scriptPath}" "${base64Prompt}" "${base64Neg}" "${brollPath}" --base64`;
                
                await execAsync(cmd);
                
                if (fs.existsSync(brollPath)) {
                    localPath = brollPath;
                }
            } catch (e: any) {
                console.error(`Veo generation failed for broll ${index}:`, e?.message || e);
            }
            
            downloadedBrolls.push({ ...b, localPath, index });
        }));
    }

    // 3. Build FFmpeg Command
    let command = ffmpeg(avatarPath);
    let complexFilter: any[] = [];
    
    // Add all downloaded B-rolls as inputs
    downloadedBrolls.forEach(b => {
        if (b.localPath) {
            if (b.localPath.endsWith('.jpg')) {
                command = command.input(b.localPath).inputOptions(['-loop', '1']);
            } else {
                command = command.input(b.localPath);
            }
        }
    });

    if (downloadedBrolls.length > 0) {
        let lastOutput = '[0:v]';
        let currentInputIdx = 1;
        
        downloadedBrolls.forEach((b: any, i: number) => {
            if (b.localPath) {
                const outId = `[out_${i}]`;
                const scaledId = `[scaled_${i}]`;
                
                // Delay B-roll to exactly `b.start_second` seconds, scale to match 9:16 vertical avatar, crop
                complexFilter.push({
                    filter: 'setpts',
                    options: `PTS-STARTPTS+${b.start_second || b.start || 0}/TB`,
                    inputs: `[${currentInputIdx}:v]`,
                    outputs: `[pts_${i}]`
                });
                complexFilter.push({
                    filter: 'scale',
                    options: '1080:1920:force_original_aspect_ratio=increase',
                    inputs: `[pts_${i}]`,
                    outputs: `[scale_tmp_${i}]`
                });
                complexFilter.push({
                    filter: 'crop',
                    options: '1080:1920',
                    inputs: `[scale_tmp_${i}]`,
                    outputs: scaledId
                });
                // Overlay perfectly onto the avatar video
                complexFilter.push({
                    filter: 'overlay',
                    options: { enable: `between(t,${b.start_second || b.start || 0},${b.end_second || b.end || 0})`, eof_action: 'pass' },
                    inputs: [lastOutput, scaledId],
                    outputs: outId
                });
                
                currentInputIdx++;
                lastOutput = outId;
            }
        });
        
        if (complexFilter.length > 0) {
            command = command.complexFilter(complexFilter, lastOutput);
        }
    }

    // Process Video
    await new Promise((resolve, reject) => {
        command
            .outputOptions(['-map 0:a?', '-y']) // preserve HeyGen avatar audio
            .videoCodec('libx264')
            .audioCodec('aac')
            .on('end', resolve)
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg stderr:', stderr);
                reject(err);
            })
            .save(outputPath);
    });

    // 4. Upload stitched MP4 to Cloudinary
    const finalBuffer = fs.readFileSync(outputPath);
    const finalVideoUrl = await new Promise<string>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { resource_type: "video", folder: "dr_kiran_assembled" },
            (error, result) => {
                if (error) return reject(error);
                if (result) return resolve(result.secure_url);
                reject(new Error("Unknown Cloudinary error"));
            }
        );
        uploadStream.end(finalBuffer);
    });

    return NextResponse.json({ success: true, finalVideoUrl });
  } catch (error: any) {
    console.error('Assemble Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}
