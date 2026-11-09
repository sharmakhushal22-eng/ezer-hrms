// src/features/expenses/contact/ContactFields.tsx — "How we reach you" on the trip
// and claim forms (components/te/TeContactFields.tsx), plus the desk's read-only
// contact line (components/te/TeContact.tsx).
//
// Prefilled from ESS (snap.contact); what the traveller leaves is stored on the
// trip or claim and never written back to their profile. The caller decides when
// an error may show (nothing while the form is still being filled).
import * as React from 'react'
import { Linking, Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'

export interface ContactValue {
  contactMobile: string
  contactAltMobile: string
  contactEmail: string
}

export function ContactFields({ value, prefilled, onChange, error, heading }: {
  value: ContactValue
  prefilled?: { mobile: string; altMobile: string; email: string }
  onChange: (patch: Partial<ContactValue>) => void
  error: (key: keyof ContactValue) => string
  heading?: string
}) {
  const { C } = useTheme()
  const canReset = !!prefilled && (
    (!!prefilled.mobile && value.contactMobile !== prefilled.mobile)
    || (!!prefilled.altMobile && value.contactAltMobile !== prefilled.altMobile)
    || (!!prefilled.email && value.contactEmail !== prefilled.email)
  )
  return (
    <View style={{ marginTop: S.md }}>
      <Txt size={F.small} w={700} style={{ marginBottom: S.sm }}>{heading ?? 'How we reach you'}</Txt>
      <Input label="Mobile" value={value.contactMobile} onChangeText={t => onChange({ contactMobile: t })}
        keyboardType="phone-pad" autoComplete="tel" placeholder="98765 43210"
        help="The number to ring first." error={error('contactMobile') || undefined} />
      <Input label="Second number" value={value.contactAltMobile} onChangeText={t => onChange({ contactAltMobile: t })}
        keyboardType="phone-pad" autoComplete="tel" placeholder="A colleague, or your other number"
        help="For when the first one cannot be reached." error={error('contactAltMobile') || undefined} />
      <Input label="Email" value={value.contactEmail} onChangeText={t => onChange({ contactEmail: t })}
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@company.com"
        help="Tickets and anything about this are sent here." error={error('contactEmail') || undefined} />
      <Txt size={F.tiny} tone="muted">
        Filled in from your EZER profile. Change anything here that is different while you are away — it applies
        to this trip only and does not change your profile.
      </Txt>
      {canReset ? (
        <Pressable accessibilityRole="button" hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}
          onPress={() => onChange({ contactMobile: prefilled!.mobile, contactAltMobile: prefilled!.altMobile, contactEmail: prefilled!.email })}>
          <Txt size={F.tiny} w={600} color={C.brand}>Use my profile details</Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

/** TeContact.prettyMobile: ten digits shown grouped, anything else as stored. */
export function prettyMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : raw.trim()
}

function ContactItem({ icon, text, url, note }: { icon: string; text: string; url: string; note?: string }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}>
      <TeIcon name={icon} size="sm" color={C.brand} />
      <Txt size={F.tiny} w={600} color={C.brand}>{text}</Txt>
      {note ? <Txt size={F.tiny} tone="muted">{note}</Txt> : null}
    </Pressable>
  )
}

/** TeContact: tap-to-call / tap-to-mail line for a desk row. */
export function ContactLine({ contact: c }: { contact?: { mobile: string; altMobile: string; email: string; from?: 'form' | 'record' } | null }) {
  if (!c || (!c.mobile && !c.altMobile && !c.email)) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: S.md }}>
      {c.mobile ? <ContactItem icon="phone" text={prettyMobile(c.mobile)} url={`tel:${c.mobile.replace(/\s/g, '')}`} /> : null}
      {c.altMobile ? <ContactItem icon="phone" text={prettyMobile(c.altMobile)} url={`tel:${c.altMobile.replace(/\s/g, '')}`} note="2nd" /> : null}
      {c.email ? <ContactItem icon="mail" text={c.email} url={`mailto:${c.email}`} /> : null}
      {c.from === 'record' ? <Txt size={F.tiny} tone="muted">not confirmed</Txt> : null}
    </View>
  )
}
