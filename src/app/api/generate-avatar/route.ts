import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { audioUrl, selectedAvatar } = await req.json();

    if (!audioUrl) {
      return NextResponse.json({ error: 'Missing audioUrl' }, { status: 400 });
    }

    const heygenApiKey = process.env.HEYGEN_API_KEY;
    
    // Map the selected string to specific environment variables
    const avatarEnvMap: Record<string, string | undefined> = {
      "Casual": process.env.HEYGEN_AVATAR_ID_CASUAL,
      "Scrub": process.env.HEYGEN_AVATAR_ID_SCRUB,
      "Formal": process.env.HEYGEN_AVATAR_ID_FORMAL,
      "Studio": process.env.HEYGEN_AVATAR_ID_STUDIO,
    };

    // Use the specific ID if it exists, otherwise fallback to the default ID
    const heygenAvatarId = (selectedAvatar ? avatarEnvMap[selectedAvatar] : null) 
      || process.env.NEXT_PUBLIC_HEYGEN_AVATAR_ID 
      || process.env.HEYGEN_AVATAR_ID;

    if (!heygenApiKey || !heygenAvatarId) {
      return NextResponse.json({ error: 'HeyGen API Key or Avatar ID missing' }, { status: 500 });
    }

    // Step 1: Submit generation request
    const generateRes = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': heygenApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: heygenAvatarId,
              avatar_style: 'normal',
              version: 'v4',
            },
            voice: {
              type: 'audio',
              audio_url: audioUrl,
            },
          },
        ],
        dimension: {
          width: 1080,
          height: 1920,
        },
      }),
    });

    const generateData = await generateRes.json();
    if (generateData.error || !generateData.data?.video_id) {
      throw new Error(generateData.error?.message || 'Failed to submit HeyGen video generation');
    }

    const videoId = generateData.data.video_id;

    // Step 2: Poll for completion (Wait up to ~5 mins)
    let videoUrl = null;
    let attempts = 0;
    const maxAttempts = 60; // 60 * 5s = 5 minutes

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5s

      const statusRes = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': heygenApiKey,
        },
      });

      const statusData = await statusRes.json();
      
      if (statusData.data?.status === 'completed') {
        videoUrl = statusData.data.video_url;
        break;
      } else if (statusData.data?.status === 'failed') {
        throw new Error('HeyGen video generation failed');
      }

      attempts++;
    }

    if (!videoUrl) {
      throw new Error('HeyGen video generation timed out');
    }

    return NextResponse.json({ success: true, avatarVideoUrl: videoUrl });

  } catch (error: any) {
    console.error('HeyGen API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
