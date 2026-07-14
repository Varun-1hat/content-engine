import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const data = await req.json();
    const { topic, hookType, severity, content } = data;

    const { data: insertedData, error } = await supabase
      .from('scripts')
      .insert([
        { topic, hook_type: hookType, severity, content }
      ])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data: insertedData });
  } catch (error: any) {
    console.error('Error saving script:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
