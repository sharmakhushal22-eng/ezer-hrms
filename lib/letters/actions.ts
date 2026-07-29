// ================================================================
// EZER HRMS — Post-generation letter actions
// Path: lib/letters/actions.ts
// The three things you can do with an already-generated letter:
// download it, email it, publish it to the employee's ESS.
// ================================================================
import { supabase } from '@/lib/supabase'

export async function getGeneratedLetterDownloadUrl(fileUrl: string): Promise<string | null> {
  const { data } = await supabase.storage.from('generated-letters').createSignedUrl(fileUrl, 300)
  return data?.signedUrl ?? null
}

export async function publishLetterToEss(generatedLetterId: string) {
  return supabase.from('generated_letters')
    .update({ published_to_ess_at: new Date().toISOString() })
    .eq('id', generatedLetterId)
}

export async function unpublishLetterFromEss(generatedLetterId: string) {
  return supabase.from('generated_letters')
    .update({ published_to_ess_at: null })
    .eq('id', generatedLetterId)
}
