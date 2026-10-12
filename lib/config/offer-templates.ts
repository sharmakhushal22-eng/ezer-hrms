// lib/config/offer-templates.ts — built-in text of the six offer letters and six offer
// emails, one per engagement (lib/recruitment/engagement.ts).
//
// Pure. This is the wording lib/recruitment/offer-letter-pdf.ts and the Send Offers screen
// used before it became editable, rewritten in template form — the letter tests
// (lib/config/__tests__/offer-letter.test.ts) prove the letters render to exactly the old
// text for every engagement. Layout of a letter template: see lib/config/offer-letter.ts.

import type { TemplateDef, TemplateVar } from './registry.ts'
import { offerLetterVars, sampleFacts, OFFER_LETTER_KEY } from './offer-letter.ts'
import { offerMailVarsSample, OFFER_EMAIL_KEY } from './offer-mail.ts'
import type { LetterKind } from '../recruitment/engagement.ts'

// ── Clauses several letters share ────────────────────────────────────────────

const CONDITIONS = 'This offer is subject to satisfactory verification of your background, references and the documents you have provided, submission of the original documents listed by the Company on or before the commencement date, and the accuracy of the information you have given. If any information is found to be incorrect or incomplete, the Company may withdraw this offer or end the engagement.'
const VALIDITY = 'This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail.'
const CONFIDENTIALITY = 'You will keep confidential all information about the Company, its group companies, customers, suppliers, employees and business that you receive or create during the engagement, and will not use or disclose it, during or after the engagement, for any purpose other than the work assigned to you.'
const IP = 'All work product, inventions, designs, code, documents, data and other material you create in the course of the engagement, and all intellectual property in them, belong to the Company absolutely from the moment of creation; you assign to the Company any rights that may vest in you and will sign what is needed to give effect to this.'
const PROPERTY = 'All property, documents, data, access credentials and equipment given to you remain the Company\'s property and must be returned on the last day of the engagement or earlier on request.'
const CONDUCT = 'You will abide by the Company\'s code of conduct, policies on prevention of sexual harassment, information security and data protection, and its rules in force from time to time at the place where you are engaged.'
const LAW = 'This letter is governed by the laws of India. Courts at {{jurisdiction}} have jurisdiction.'
const WHERE = '{{#if department}}, in the {{department}} department{{/if}}{{#if location}}, at {{location}}{{/if}}'

const lines = (...l: string[]) => l.join('\n\n')

// ── The six letters ──────────────────────────────────────────────────────────

const LETTER_BODY: Record<LetterKind, { subject: string; body: string }> = {
  EMPLOYMENT: {
    subject: 'Offer of Employment — {{role}}',
    body: lines(
      'With reference to your application and the subsequent discussions and interviews you had with us, we are pleased to offer you the position of {{role}} at {{company_name}} (the "Company"){{#if department}}, in the {{department}} department{{/if}}{{#if location}}, based at {{location}}{{/if}}, on the terms and conditions set out in this letter and its annexures.',
      '[Date of joining] You are requested to join on or before {{start_date}}. If you are unable to join on this date, please inform us in advance; the Company may revise or withdraw this offer if you do not join on the agreed date.',
      '[Compensation] Your total annual Cost to Company (CTC) will be {{ctc}}{{#if variable}}, comprising a fixed component of {{fixed}} and a variable component of {{variable}} ({{variable_pct}}% of CTC) payable as per the Company\'s performance policy{{/if}}. The detailed salary break-up is given in Annexure A. Your compensation is confidential and must not be disclosed.',
      '{{#if reports_to}}[Reporting] You will report to {{reports_to}}, or to such other person as the Company may designate from time to time.{{/if}}',
      '[Probation] You will be on probation for a period of {{probation_days}} days from your date of joining. On satisfactory completion, your employment will be confirmed in writing. The Company may extend the probation period at its discretion.',
      '[Notice period] After confirmation, either party may terminate the employment by giving {{notice_days}} days\' written notice or salary in lieu thereof. During probation, the notice period will be as per Company policy.',
      '[Conditions of offer] This offer is subject to satisfactory background and reference verification, submission of the original documents listed by the Company on or before your date of joining, and the accuracy of the information you have provided. If any information is found to be incorrect, the Company may withdraw this offer or terminate your employment.',
      `[Validity] ${VALIDITY}`,
      'We look forward to welcoming you to {{company_name}} and wish you a long and rewarding career with us.',
      '--- Annexure A notes ---\nIncome tax will be deducted at source as per the Income Tax Act, 1961 and the regime you opt for.\nStatutory contributions (PF / ESIC) are made as per the applicable laws; the employer contribution forms part of your CTC.\n{{#if variable}}The variable component is linked to individual and Company performance and is paid as per the Company\'s policy.{{/if}}\nThe Company may restructure the components of your salary from time to time without reducing your total CTC.',
      '--- Annexure B terms ---',
      '[Working hours] Your working hours, weekly off and attendance will be as per the Company\'s policy applicable to your location and function{{#if work_mode}} (work mode: {{work_mode}}){{/if}}.',
      '[Leave] You will be entitled to leave as per the Company\'s leave policy, as amended from time to time.',
      '[Transfer] Your services may be transferred to any department, location, group company or associate company of the Company, as business requires.',
      '[Confidentiality] You will keep confidential all information about the Company, its customers, employees and business, during and after your employment, and will not use it for any purpose other than your work.',
      '[Exclusive service] You will devote your full time to the Company and will not take up any other employment, business or engagement, paid or unpaid, without the Company\'s written consent.',
      '[Company property] All property, documents, data and equipment given to you remain the Company\'s property and must be returned on separation.',
      '[Code of conduct] You will abide by the Company\'s code of conduct, policies and rules in force from time to time.',
      '[Termination] The Company may terminate your employment without notice for misconduct, breach of these terms, or if any information provided by you is found to be false.',
      '[Governing law] This offer and your employment are governed by the laws of India.',
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this offer letter and its annexures, and I accept the offer of employment as {{role}} at {{company_name}} on the terms and conditions stated. I confirm that I will join on {{start_date}}.',
    ),
  },

  INTERNSHIP: {
    subject: 'Internship Offer — {{role}}',
    body: lines(
      `With reference to your application and the discussions you had with us, we are pleased to offer you an internship with {{company_name}} (the "Company") as {{role}}${WHERE}, on the terms set out in this letter and its annexures. This internship is a structured learning engagement; it does not create an employer-employee relationship between you and the Company.`,
      '[Internship period] Your internship is {{span}}. It may be extended only by written agreement, and may end earlier under clause 6 below.',
      '[Stipend] You will receive a consolidated stipend of {{monthly}} per month{{tds_clause}}, paid monthly in arrears for the period you are engaged. The stipend is a training allowance, not a salary: no provident fund, ESIC, gratuity, bonus or other statutory benefit of employment applies. The stipend details are in Annexure A.',
      '[Mentor & work] You will work under the guidance of {{guide}}, who will set your learning objectives, assign your project work and review your progress. Your work may be reassigned as business and learning needs require.',
      '[Hours & conduct] You will observe the Company\'s working hours, weekly offs and holidays applicable at your location{{#if work_mode}} (work mode: {{work_mode}}){{/if}}, and its code of conduct. Leave during the internship is as per the Company\'s internship policy and at the discretion of your mentor.',
      '[Completion] On satisfactory completion of the full internship period you will receive an internship certificate from the Company. This offer does not promise or imply employment with the Company on completion; any such offer, if made, will be separate and at the Company\'s sole discretion.',
      '[Early termination] Either party may end the internship by giving {{notice_days}} days\' written notice. The Company may end it immediately for misconduct, breach of these terms, unsatisfactory attendance or performance, or if any information you provided is found to be false. The stipend is payable up to the last day of the internship.',
      `[Conditions of offer] ${CONDITIONS}`,
      `[Validity] ${VALIDITY}`,
      'We look forward to having you learn and contribute at {{company_name}}, and wish you a rewarding internship.',
      '--- Annexure A notes ---\nThe stipend is a fixed training allowance paid for the period of the internship. It is not wages or salary, and no PF, ESIC, gratuity, bonus, leave encashment or other statutory benefit of employment applies.\nIncome tax, where applicable, is deducted at source. The tax treatment of a stipend depends on your own facts; please consult your tax advisor.\nThe stipend is paid monthly in arrears, by bank transfer to the account you register with the Company, for the days you are engaged.',
      '--- Annexure B terms ---',
      '[Nature of engagement] You are engaged as an intern for training and learning. Nothing in this letter makes you an employee of the Company, and you will not claim employment, wages, or any benefit available to employees, during or after the internship.',
      `[Confidentiality] ${CONFIDENTIALITY}`,
      `[Intellectual property] ${IP}`,
      `[Attendance & conduct] You will attend regularly for the agreed hours, keep your mentor informed of your work, and follow the Company's policies and instructions. ${CONDUCT}`,
      '[Other engagements] You may continue your studies. You will not take up any engagement with a competitor of the Company, or any work that conflicts with your internship, during its period.',
      `[Company property & systems] ${PROPERTY} You will use the Company's systems only for your assigned work and in line with its information security policy.`,
      '[Certificate] An internship certificate is issued only on satisfactory completion of the full period and return of all Company property. No certificate is issued for an internship ended early for cause.',
      `[Governing law] ${LAW}`,
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this internship offer and its annexures, and I accept the internship as {{role}} at {{company_name}} on the terms stated. I understand that this is an internship and not an offer of employment, and that I will commence on {{start_date}}.',
    ),
  },

  NATS: {
    subject: 'Offer of Apprenticeship Training under the National Apprenticeship Training Scheme — {{role}}',
    body: lines(
      `Pursuant to your application on the NATS portal and the selection process, {{company_name}} (the "Company") is pleased to offer you a place as a {{category}} in {{role}}${WHERE}, under the {{scheme_act}} and the {{scheme_name}} administered by the {{scheme_authority}}. This is an offer of apprenticeship training under the Act; it is not an offer of employment.`,
      '[Contract of Apprenticeship] Your training is governed by a Contract of Apprenticeship to be executed between you and the Company and registered on the {{scheme_short}} portal ({{scheme_portal}}){{#if registration}}. Registration / enrolment no.: {{registration}}{{/if}}. Your Aadhaar, a bank account seeded to it and the e-KYC on the portal are required before training begins, as the Government\'s share of the stipend is paid to you directly.',
      '[Period of training] Your apprenticeship is {{span}}, as per the training schedule approved for your discipline. Where your attendance falls short of what the Rules require, the period is extended to make up the shortfall, as provided in the Act.',
      '[Stipend] You will be paid a stipend of {{monthly}} per month{{minimum_stipend_clause}}{{tds_clause}}. Under the {{scheme_short}}, {{scheme_gov_share}}; where admissible this share is credited directly to your Aadhaar-seeded bank account by Direct Benefit Transfer, and the Company pays the balance, so that you receive the stipend in full. The stipend is not wages: no provident fund, ESIC, gratuity or bonus applies. Details are in Annexure A.',
      '[Training & supervision] You will be trained under {{guide}} as per the approved training programme, and your progress will be assessed periodically. Your hours of training follow the working hours of the establishment as permitted by the {{scheme_rules}}; you will not be required to train overtime except with the approval of the Apprenticeship Adviser. Attendance records will be maintained and reported on the portal.',
      '[Leave & holidays] You are entitled to leave and holidays as provided under the {{scheme_rules}} and the Company\'s practice for apprentices, as recorded in your Contract of Apprenticeship.',
      '[Status, completion & certificate] Under section 18 of the {{scheme_act}} you are an apprentice and not a worker or employee of the Company, and the labour laws (other than the health and safety provisions of the Factories Act, 1948) do not apply to you. Under section 22, the Company is under no obligation to offer you employment on completion, nor are you bound to accept any such offer, unless otherwise agreed in the Contract. On successful completion and the prescribed final assessment you will receive the {{scheme_certificate}}.',
      '[Termination of the contract] The Contract of Apprenticeship may be terminated as provided in section 7 of the Act: by mutual consent through the Apprenticeship Adviser, or on application by either party for failure to carry out the terms of the contract, with such consequences as the Act and Rules provide.',
      `[Conditions of offer] ${CONDITIONS} The documents include your educational certificates, Aadhaar, PAN, NATS enrolment ID, bank details and a certificate of medical fitness.`,
      '[Validity] This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail; the Contract of Apprenticeship will then be executed and registered.',
      'We look forward to training you at {{company_name}} and wish you a successful apprenticeship.',
      '--- Annexure A notes ---\nThe minimum stipend is prescribed under Rule 11 of the {{scheme_rules}} as amended by {{stipend_notification}}, with an increase of {{stipend_yearly_increase}}. The Company\'s stipend will never be below the prescribed minimum.\nUnder the {{scheme_short}}, {{scheme_gov_share}}. It is credited to the apprentice\'s Aadhaar-seeded bank account by Direct Benefit Transfer where admissible; the Company pays the balance. Should the Government\'s share not be received for any period, the Company pays the full stipend.\nAn apprentice is not a worker (s.18, Apprentices Act, 1961): no provident fund, ESIC, gratuity, bonus or other benefit of employment applies to the stipend.\nIncome tax, where applicable, is deducted at source. Please consult your tax advisor on the treatment of the stipend.',
      '--- Annexure B terms ---',
      '[Obligations of the apprentice] You will learn your trade or subject field conscientiously and diligently, attend training regularly, carry out all lawful instructions of the Company and the persons placed in authority over you, and fulfil the obligations under the Act, the Rules and the Contract (section 12 of the Act).',
      '[Obligations of the Company] The Company will impart training in accordance with the approved programme, make suitable arrangements for your training, pay the stipend set out in Annexure A, and carry out its obligations under the Act, the Rules and the Contract (section 11 of the Act).',
      '[Nature of engagement] You are an apprentice undergoing training. Nothing in this letter or the Contract makes you an employee of the Company, and you will not claim employment, wages, or any benefit available to employees, during or after the apprenticeship.',
      `[Attendance & conduct] You will keep the hours of training fixed for you, record your attendance as required, and follow the Company's rules of discipline for apprentices. ${CONDUCT}`,
      '[Health & safety] The health and safety provisions of the Factories Act, 1948 and the Company\'s safety rules apply to you. You will use the protective equipment provided and follow all safety instructions.',
      `[Confidentiality] ${CONFIDENTIALITY}`,
      `[Intellectual property] ${IP}`,
      `[Company property] ${PROPERTY}`,
      '[Absence & extension] Absence beyond the leave permitted under the Rules extends the period of training to make up the shortfall. Unauthorised absence may lead to termination of the Contract under section 7 of the Act.',
      '[Governing law] The {{scheme_act}}, the {{scheme_rules}} and the laws of India govern this letter and the Contract. Disputes under the Contract are referred to the Apprenticeship Adviser as the Act provides.',
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this offer of apprenticeship training and its annexures, and I accept the apprenticeship as {{category}} at {{company_name}} under the {{scheme_act}} on the terms stated. I understand that this is apprenticeship training and not an offer of employment, that I must complete my registration and e-KYC on the {{scheme_short}} portal, and that my training will commence on {{start_date}}.',
    ),
  },

  NAPS: {
    subject: 'Offer of Apprenticeship under the National Apprenticeship Promotion Scheme — {{trade_or_role}}',
    body: lines(
      `Pursuant to your application on the apprenticeship portal and the selection process, {{company_name}} (the "Company") is pleased to engage you as a {{category}}{{role_suffix}}${WHERE}, under the {{scheme_act}} and the {{scheme_name}} of the {{scheme_authority}}. This is an offer of apprenticeship training under the Act; it is not an offer of employment.`,
      '[Contract of Apprenticeship] Your training is governed by a Contract of Apprenticeship to be executed between you (and your guardian, if you are a minor) and the Company and registered on the {{scheme_short}} portal ({{scheme_portal}}) within 30 days of its execution{{#if registration}}. Registration / enrolment no.: {{registration}}{{/if}}. Your Aadhaar, a bank account seeded to it and the e-KYC on the portal are required before training begins, as the Government\'s share of the stipend is paid to you directly.',
      '[Period of training] Your apprenticeship is {{span}}, comprising basic training and on-the-job training as per the curriculum for the trade. Where your attendance falls short of what the Rules require, the period is extended to make up the shortfall, as provided in the Act.',
      '[Stipend] You will be paid a stipend of {{monthly}} per month{{minimum_stipend_clause}}{{tds_clause}}. Under the {{scheme_short}}, {{scheme_gov_share}}; where admissible this share is credited directly to your Aadhaar-seeded bank account by Direct Benefit Transfer, and the Company pays the balance, so that you receive the stipend in full. The stipend is not wages: no provident fund, ESIC, gratuity or bonus applies. Details are in Annexure A.',
      '[Training & supervision] You will be trained under {{guide}} as per the curriculum for the trade, and your progress will be assessed periodically. Your hours of training follow the working hours of the establishment as permitted by the {{scheme_rules}}; you will not be required to train overtime except with the approval of the Apprenticeship Adviser. Attendance records will be maintained and reported on the portal.',
      '[Leave & holidays] You are entitled to leave and holidays as provided under the {{scheme_rules}} and the Company\'s practice for apprentices, as recorded in your Contract of Apprenticeship.',
      '[Status, completion & certificate] Under section 18 of the {{scheme_act}} you are an apprentice and not a worker or employee of the Company, and the labour laws (other than the health and safety provisions of the Factories Act, 1948) do not apply to you. Under section 22, the Company is under no obligation to offer you employment on completion, nor are you bound to accept any such offer, unless otherwise agreed in the Contract. On successful completion and the prescribed final assessment you will receive the {{scheme_certificate}}.',
      '[Termination of the contract] The Contract of Apprenticeship may be terminated as provided in section 7 of the Act: by mutual consent through the Apprenticeship Adviser, or on application by either party for failure to carry out the terms of the contract, with such consequences as the Act and Rules provide.',
      `[Conditions of offer] ${CONDITIONS} The documents include your educational certificates, Aadhaar, PAN, apprenticeship registration ID, bank details and a certificate of medical fitness.`,
      '[Validity] This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail; the Contract of Apprenticeship will then be executed and registered.',
      'We look forward to training you at {{company_name}} and wish you a successful apprenticeship.',
      '--- Annexure A notes ---\nThe minimum stipend is prescribed under Rule 11 of the {{scheme_rules}} as amended by {{stipend_notification}}, with an increase of {{stipend_yearly_increase}}. The Company\'s stipend will never be below the prescribed minimum.\nUnder the {{scheme_short}}, {{scheme_gov_share}}. It is credited to the apprentice\'s Aadhaar-seeded bank account by Direct Benefit Transfer where admissible; the Company pays the balance. Should the Government\'s share not be received for any period, the Company pays the full stipend.\nAn apprentice is not a worker (s.18, Apprentices Act, 1961): no provident fund, ESIC, gratuity, bonus or other benefit of employment applies to the stipend.\nIncome tax, where applicable, is deducted at source. Please consult your tax advisor on the treatment of the stipend.',
      '--- Annexure B terms ---',
      '[Obligations of the apprentice] You will learn your trade or subject field conscientiously and diligently, attend training regularly, carry out all lawful instructions of the Company and the persons placed in authority over you, and fulfil the obligations under the Act, the Rules and the Contract (section 12 of the Act).',
      '[Obligations of the Company] The Company will impart training in accordance with the curriculum for the trade, make suitable arrangements for your training, pay the stipend set out in Annexure A, and carry out its obligations under the Act, the Rules and the Contract (section 11 of the Act).',
      '[Nature of engagement] You are an apprentice undergoing training. Nothing in this letter or the Contract makes you an employee of the Company, and you will not claim employment, wages, or any benefit available to employees, during or after the apprenticeship.',
      `[Attendance & conduct] You will keep the hours of training fixed for you, record your attendance as required, and follow the Company's rules of discipline for apprentices. ${CONDUCT}`,
      '[Health & safety] The health and safety provisions of the Factories Act, 1948 and the Company\'s safety rules apply to you. You will use the protective equipment provided and follow all safety instructions.',
      `[Confidentiality] ${CONFIDENTIALITY}`,
      `[Intellectual property] ${IP}`,
      `[Company property] ${PROPERTY}`,
      '[Absence & extension] Absence beyond the leave permitted under the Rules extends the period of training to make up the shortfall. Unauthorised absence may lead to termination of the Contract under section 7 of the Act.',
      '[Governing law] The {{scheme_act}}, the {{scheme_rules}} and the laws of India govern this letter and the Contract. Disputes under the Contract are referred to the Apprenticeship Adviser as the Act provides.',
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this offer of apprenticeship training and its annexures, and I accept the apprenticeship as {{category}} at {{company_name}} under the {{scheme_act}} on the terms stated. I understand that this is apprenticeship training and not an offer of employment, that I must complete my registration and e-KYC on the {{scheme_short}} portal, and that my training will commence on {{start_date}}.',
    ),
  },

  CONTRACT: {
    subject: 'Fixed-Term Contract Engagement — {{role}}',
    body: lines(
      `Further to our discussions, {{company_name}} (the "Company") is pleased to engage you as an independent contractor to provide services as {{role}}${WHERE}, on the terms set out in this letter and its annexures. This is a contract for services; it does not create an employer-employee relationship, partnership or agency between you and the Company.`,
      '[Term] The engagement is {{span}}. It ends automatically on the end date unless renewed by written agreement; neither party is under any obligation to renew, and no expectation of renewal or of employment arises from this engagement.',
      '[Services & reporting] You will provide the services of {{role}}{{#if department}} to the {{department}} function{{/if}} with due skill, care and diligence, to the standard the Company reasonably requires, and will coordinate your work with {{coordinator}}. You decide how the services are performed within the Company\'s requirements, timelines and site rules.',
      '[Fees] The Company will pay you professional fees of {{monthly}} per month against your monthly invoice{{tds_clause}}. Where you are registered under GST, GST is payable over and above the fees on a valid tax invoice. Fees are paid within 15 days of receipt of a correct invoice, by bank transfer. The fee details are in Annexure A. No other payment, allowance, reimbursement or benefit is payable unless agreed in writing.',
      '[Independent status] You are responsible for your own income tax, GST and other statutory dues. As an independent contractor you are not entitled to provident fund, ESIC, gratuity, bonus, leave, insurance or any other benefit the Company provides to its employees, and the Company\'s employment policies do not apply to you except its rules on conduct, safety, confidentiality and information security while on its premises or systems.',
      '[Exclusivity & conflicts] During the engagement you will not provide services to a competitor of the Company or take up any engagement that conflicts with, or impairs your availability for, the services, without the Company\'s written consent.',
      '[Termination] Either party may end the engagement by giving {{notice_days}} days\' written notice. The Company may end it immediately for breach of these terms, misconduct, failure to provide the services to the required standard, or if any information you provided is found to be false. Fees are payable pro rata up to the last day of the engagement, against your final invoice.',
      `[Conditions of engagement] ${CONDITIONS} The documents include your PAN, GST registration (if any), bank details, address proof and identity proof.`,
      `[Validity] ${VALIDITY}`,
      'We look forward to working with you.',
      '--- Annexure A notes ---\nFees are for services rendered and are not salary or wages. No provident fund, ESIC, gratuity, bonus, leave encashment or any other employee benefit applies.\nTax is deducted at source under section 194J of the Income-tax Act, 1961 at the applicable rate and a TDS certificate is issued. You are responsible for your own income tax and GST compliance.\nEach invoice must carry your PAN (and GSTIN, where registered), the period of service and the fees for that period.',
      '--- Annexure B terms ---',
      '[Standard of services] You will provide the services personally, with the skill, care and diligence of a competent professional, in line with the Company\'s reasonable requirements, timelines and applicable law, and will promptly correct any deficiency the Company points out.',
      `[Confidentiality] ${CONFIDENTIALITY}`,
      `[Intellectual property] ${IP} You warrant that your work product will not infringe any third party's rights.`,
      '[Data protection] You will process personal data you receive only as instructed by the Company, keep it secure, and return or delete it at the end of the engagement, in line with the Digital Personal Data Protection Act, 2023 and the Company\'s policies.',
      `[Conduct on premises & systems] ${CONDUCT}`,
      '[Non-solicitation] For 12 months after the engagement ends you will not solicit for employment or engagement any employee of the Company with whom you worked, nor solicit the Company\'s customers for a competing business.',
      `[Company property] ${PROPERTY}`,
      '[Indemnity] You will indemnify the Company against loss arising from your breach of these terms, your negligence or wilful misconduct, or any claim that you are an employee of the Company.',
      '[No authority] You have no authority to bind the Company or hold yourself out as its employee or agent.',
      `[Governing law] ${LAW}`,
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this engagement letter and its annexures, and I accept the engagement as an independent contractor to provide services as {{role}} to {{company_name}} on the terms stated. I understand that this is a contract for services and not employment, and that my engagement commences on {{start_date}}.',
    ),
  },

  CONSULTANT: {
    subject: 'Consulting Engagement — {{role}}',
    body: lines(
      `Further to our discussions, {{company_name}} (the "Company") is pleased to engage you as an independent consultant to provide services as {{role}}${WHERE}{{#if months}} for a term of {{period}}{{/if}}, on the terms set out in this letter and its annexures. This is a contract for services; it does not create an employer-employee relationship, partnership or agency between you and the Company.`,
      '[Term] {{#if fixed_term}}The engagement is {{span}}. It ends automatically on the end date unless renewed by written agreement; neither party is under any obligation to renew, and no expectation of renewal or of employment arises from this engagement.{{/if}}{{#if open_ended}}The engagement commences on {{start_date}} and continues until ended by either party under clause 6 below.{{/if}}',
      '[Services & reporting] You will provide the services of {{role}}{{#if department}} to the {{department}} function{{/if}} with due skill, care and diligence, to the standard the Company reasonably requires, and will coordinate your work with {{coordinator}}. You decide how the services are performed within the Company\'s requirements, timelines and site rules.',
      '[Fees] The Company will pay you professional fees of {{monthly}} per month against your monthly invoice{{tds_clause}}. Where you are registered under GST, GST is payable over and above the fees on a valid tax invoice. Fees are paid within 15 days of receipt of a correct invoice, by bank transfer. The fee details are in Annexure A. No other payment, allowance, reimbursement or benefit is payable unless agreed in writing.',
      '[Independent status] You are responsible for your own income tax, GST and other statutory dues. As an independent consultant you are not entitled to provident fund, ESIC, gratuity, bonus, leave, insurance or any other benefit the Company provides to its employees, and the Company\'s employment policies do not apply to you except its rules on conduct, safety, confidentiality and information security while on its premises or systems.',
      '[Exclusivity & conflicts] During the engagement you will not provide services to a competitor of the Company or take up any engagement that conflicts with, or impairs your availability for, the services, without the Company\'s written consent.',
      '[Termination] Either party may end the engagement by giving {{notice_days}} days\' written notice. The Company may end it immediately for breach of these terms, misconduct, failure to provide the services to the required standard, or if any information you provided is found to be false. Fees are payable pro rata up to the last day of the engagement, against your final invoice.',
      `[Conditions of engagement] ${CONDITIONS} The documents include your PAN, GST registration (if any), bank details, address proof and identity proof.`,
      `[Validity] ${VALIDITY}`,
      'We look forward to working with you.',
      '--- Annexure A notes ---\nFees are for services rendered and are not salary or wages. No provident fund, ESIC, gratuity, bonus, leave encashment or any other employee benefit applies.\nTax is deducted at source under section 194J of the Income-tax Act, 1961 at the applicable rate and a TDS certificate is issued. You are responsible for your own income tax and GST compliance.\nEach invoice must carry your PAN (and GSTIN, where registered), the period of service and the fees for that period.',
      '--- Annexure B terms ---',
      '[Standard of services] You will provide the services personally, with the skill, care and diligence of a competent professional, in line with the Company\'s reasonable requirements, timelines and applicable law, and will promptly correct any deficiency the Company points out.',
      `[Confidentiality] ${CONFIDENTIALITY}`,
      `[Intellectual property] ${IP} You warrant that your work product will not infringe any third party's rights.`,
      '[Data protection] You will process personal data you receive only as instructed by the Company, keep it secure, and return or delete it at the end of the engagement, in line with the Digital Personal Data Protection Act, 2023 and the Company\'s policies.',
      `[Conduct on premises & systems] ${CONDUCT}`,
      '[Non-solicitation] For 12 months after the engagement ends you will not solicit for employment or engagement any employee of the Company with whom you worked, nor solicit the Company\'s customers for a competing business.',
      `[Company property] ${PROPERTY}`,
      '[Indemnity] You will indemnify the Company against loss arising from your breach of these terms, your negligence or wilful misconduct, or any claim that you are an employee of the Company.',
      '[No authority] You have no authority to bind the Company or hold yourself out as its employee or agent.',
      `[Governing law] ${LAW}`,
      '--- Acceptance ---',
      'I, {{name}}, have read and understood this engagement letter and its annexures, and I accept the engagement as an independent consultant to provide services as {{role}} to {{company_name}} on the terms stated. I understand that this is a contract for services and not employment, and that my engagement commences on {{start_date}}.',
    ),
  },
}

const LETTER_LABEL: Record<LetterKind, string> = {
  EMPLOYMENT: 'Offer letter — Employment', INTERNSHIP: 'Offer letter — Internship', NATS: 'Offer letter — NATS apprenticeship',
  NAPS: 'Offer letter — NAPS apprenticeship', CONTRACT: 'Offer letter — Fixed-term contract', CONSULTANT: 'Offer letter — Consultant',
}
const WHO: Record<LetterKind, string> = {
  EMPLOYMENT: 'employees (MRF employment type: Employee / Full time)', INTERNSHIP: 'interns (Intern / Live project / Trainee)',
  NATS: 'NATS graduate / diploma apprentices', NAPS: 'NAPS trade apprentices', CONTRACT: 'fixed-term contractors (Contract / Fixed term)',
  CONSULTANT: 'consultants (Consultant / Freelancer / Retainer)',
}

/** Labels for the letter values in the variable picker. */
const LETTER_VAR_LABEL: Record<string, string> = {
  name: 'Candidate full name', first_name: 'First name', role: 'Designation / role', company_name: 'Company name', company_short: 'Company code',
  department: 'Department (may be empty)', location: 'Job location (may be empty)', reports_to: 'Reports to (may be empty)', mentor: 'Mentor (may be empty)',
  work_mode: 'Work mode (may be empty)', guide: 'Mentor / supervisor (with a default)', coordinator: 'Coordinates with (with a default)',
  start_date: 'Start / joining date', end_date: 'End date (may be empty)', months: 'Period in months (may be empty)', period: 'Period in words',
  span: 'Period sentence ("commencing on … and ending on …")', fixed_term: 'Set when the engagement has a fixed term', open_ended: 'Set when it is open-ended',
  ctc: 'Annual CTC', fixed: 'Fixed CTC', variable: 'Variable pay (may be empty)', variable_pct: 'Variable %',
  monthly: 'Monthly stipend / fees', net_monthly: 'Net monthly payable', tds_pct: 'TDS % (may be empty)', tds_clause: 'TDS sentence part',
  probation_days: 'Probation (days)', notice_days: 'Notice (days)', jurisdiction: 'Courts at (jurisdiction)',
  category: 'Apprentice category', trade: 'Trade (may be empty)', trade_or_role: 'Trade, else role', role_suffix: '" (role)" when it differs from the trade',
  registration: 'Scheme registration no. (may be empty)', qualification: 'Qualification', institute: 'Institute (may be empty)',
  scheme_name: 'Scheme name', scheme_short: 'Scheme (short)', scheme_act: 'Act', scheme_rules: 'Rules', scheme_authority: 'Scheme authority',
  scheme_portal: 'Scheme portal', scheme_gov_share: 'Government share sentence', scheme_certificate: 'Completion certificate',
  minimum_stipend_clause: 'Minimum-stipend sentence part', stipend_notification: 'Stipend notification', stipend_yearly_increase: 'Yearly stipend increase',
}

const RELEVANT: Record<LetterKind, string[]> = {
  EMPLOYMENT: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'work_mode', 'start_date', 'ctc', 'fixed', 'variable', 'variable_pct', 'probation_days', 'notice_days', 'jurisdiction'],
  INTERNSHIP: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'mentor', 'guide', 'work_mode', 'start_date', 'end_date', 'months', 'period', 'span', 'monthly', 'net_monthly', 'tds_pct', 'tds_clause', 'notice_days', 'jurisdiction'],
  NATS: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'guide', 'start_date', 'end_date', 'months', 'period', 'span', 'monthly', 'net_monthly', 'tds_pct', 'tds_clause', 'category', 'registration', 'qualification', 'institute', 'scheme_name', 'scheme_short', 'scheme_act', 'scheme_rules', 'scheme_authority', 'scheme_portal', 'scheme_gov_share', 'scheme_certificate', 'minimum_stipend_clause', 'stipend_notification', 'stipend_yearly_increase', 'jurisdiction'],
  NAPS: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'guide', 'start_date', 'end_date', 'months', 'period', 'span', 'monthly', 'net_monthly', 'tds_pct', 'tds_clause', 'category', 'trade', 'trade_or_role', 'role_suffix', 'registration', 'qualification', 'scheme_name', 'scheme_short', 'scheme_act', 'scheme_rules', 'scheme_authority', 'scheme_portal', 'scheme_gov_share', 'scheme_certificate', 'minimum_stipend_clause', 'stipend_notification', 'stipend_yearly_increase', 'jurisdiction'],
  CONTRACT: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'coordinator', 'start_date', 'end_date', 'months', 'period', 'span', 'monthly', 'net_monthly', 'tds_pct', 'tds_clause', 'notice_days', 'jurisdiction'],
  CONSULTANT: ['name', 'first_name', 'role', 'company_name', 'company_short', 'department', 'location', 'reports_to', 'coordinator', 'start_date', 'end_date', 'months', 'period', 'span', 'fixed_term', 'open_ended', 'monthly', 'net_monthly', 'tds_pct', 'tds_clause', 'notice_days', 'jurisdiction'],
}

const KINDS: LetterKind[] = ['EMPLOYMENT', 'INTERNSHIP', 'NATS', 'NAPS', 'CONTRACT', 'CONSULTANT']

export const OFFER_LETTER_TEMPLATES: TemplateDef[] = KINDS.map(kind => {
  const sample = offerLetterVars(sampleFacts(kind))
  // Every value the vars builder knows is allowed, so an editor can use any of them;
  // the picker shows the ones that matter for this engagement first.
  const names = [...RELEVANT[kind], ...Object.keys(sample).filter(k => !RELEVANT[kind].includes(k))]
  return {
    key: OFFER_LETTER_KEY[kind],
    channel: 'LETTER' as const, module: 'Recruitment' as const,
    label: LETTER_LABEL[kind],
    description: `The offer letter PDF for ${WHO[kind]}. Layout: opening paragraph, then numbered clauses — a paragraph starting with [Heading] — then the closing; Annexure A notes, Annexure B terms and the acceptance follow their "--- … ---" lines. The letterhead, reference, Annexure A figures, salary break-up and signatory are added by the system.`,
    usedIn: 'Recruitment → Send Offers → offer file → Generate letter / Send (and the HR Head review)',
    recipient: 'Candidate',
    subjectLabel: 'Letter subject line',
    letterLayout: 'offer',
    variables: names.map((n): TemplateVar => ({ name: n, label: LETTER_VAR_LABEL[n] || n, sample: sample[n] ?? '' })),
    defaults: LETTER_BODY[kind],
  }
})

// ── The six offer emails ─────────────────────────────────────────────────────

const MAIL_OPEN: Record<LetterKind, string> = {
  EMPLOYMENT: 'Congratulations! We are delighted to offer you the position of {{role}} at {{company_name}}.',
  INTERNSHIP: 'Congratulations! We are delighted to offer you an internship as {{role}} at {{company_name}}.',
  NATS: 'Congratulations! We are pleased to offer you a place as an apprentice in {{role}} at {{company_name}} under the National Apprenticeship Training Scheme (NATS), governed by the Apprentices Act, 1961.',
  NAPS: 'Congratulations! We are pleased to offer you an apprenticeship as {{role}} at {{company_name}} under the National Apprenticeship Promotion Scheme (NAPS), governed by the Apprentices Act, 1961.',
  CONTRACT: 'We are pleased to engage you as an independent contractor to provide services as {{role}} to {{company_name}} for a fixed term.',
  CONSULTANT: 'We are pleased to engage you as a consultant to provide services as {{role}} to {{company_name}}.',
}
const MAIL_EXTRA: Record<LetterKind, string> = {
  EMPLOYMENT: '',
  INTERNSHIP: '\n\nThis is an internship for learning and training; it is not an offer of employment.',
  NATS: '\n\nThe Government of India\'s share of the stipend under the scheme is paid directly to your Aadhaar-seeded bank account by DBT; please complete your registration and e-KYC on the NATS portal (nats.education.gov.in) before you join. This is apprenticeship training under the Apprentices Act, 1961 and not an offer of employment.',
  NAPS: '\n\nThe Government of India\'s share of the stipend under the scheme is paid directly to your Aadhaar-seeded bank account by DBT; please complete your registration and e-KYC on the apprenticeship portal (apprenticeshipindia.gov.in) before you join. This is apprenticeship training under the Apprentices Act, 1961 and not an offer of employment.',
  CONTRACT: '\n\nThis is a contract for services, not employment. Fees are paid against your monthly invoice, with TDS under section 194J.',
  CONSULTANT: '\n\nThis is a contract for services, not employment. Fees are paid against your monthly invoice, with TDS under section 194J.',
}
const MAIL_CLOSE: Record<LetterKind, string> = {
  EMPLOYMENT: 'We look forward to welcoming you to the team.',
  INTERNSHIP: 'We look forward to having you with us.', NATS: 'We look forward to having you with us.', NAPS: 'We look forward to having you with us.',
  CONTRACT: 'We look forward to working with you.', CONSULTANT: 'We look forward to working with you.',
}
const MAIL_LABEL: Record<LetterKind, string> = {
  EMPLOYMENT: 'Offer email — Employment', INTERNSHIP: 'Offer email — Internship', NATS: 'Offer email — NATS apprenticeship',
  NAPS: 'Offer email — NAPS apprenticeship', CONTRACT: 'Offer email — Fixed-term contract', CONSULTANT: 'Offer email — Consultant',
}
const MAIL_VAR_LABEL: Record<string, string> = {
  candidate_name: 'Candidate name', role: 'Designation / role', company_name: 'Company name', mail_subject: 'Subject stem for this engagement',
  document_name: 'Letter name ("offer letter", "internship offer letter" …)', annexure_a: 'Annexure A name ("compensation details" …)',
  pay_line: 'Pay line ("• Annual CTC: ₹…" / "• Monthly stipend: ₹…")', start_label: 'Start label ("Proposed Date of Joining" …)', start_date: 'Start date',
  period_line: 'Period line (fixed-term only, may be empty)',
}

export const OFFER_EMAIL_TEMPLATES: TemplateDef[] = KINDS.map(kind => {
  const sample = offerMailVarsSample(kind)
  return {
    key: OFFER_EMAIL_KEY[kind],
    channel: 'EMAIL' as const, module: 'Recruitment' as const,
    label: MAIL_LABEL[kind],
    description: `The email the ${kind === 'EMPLOYMENT' ? 'offer letter' : 'letter'} PDF is attached to, for ${WHO[kind]}. It refreshes when HR edits the offer file, and HR can still adjust it before sending.`,
    usedIn: 'Recruitment → Send Offers → offer file → Send',
    recipient: 'Candidate (+ CC)',
    subjectLabel: 'Subject',
    variables: Object.keys(MAIL_VAR_LABEL).map(n => ({ name: n, label: MAIL_VAR_LABEL[n], sample: sample[n] ?? '' })),
    defaults: {
      subject: '{{mail_subject}} — {{role}} | {{company_name}}',
      body: `Dear {{candidate_name}},

${MAIL_OPEN[kind]}

Your {{document_name}} is attached to this email as a PDF. Please read it, including the {{annexure_a}} in Annexure A and the terms in Annexure B.

Key details:
{{pay_line}}
• {{start_label}}: {{start_date}}{{period_line}}

This offer is valid for 7 days and is subject to verification and document submission. To accept, please sign the acceptance in Annexure B and send us a copy, or simply reply to this email confirming your acceptance.${MAIL_EXTRA[kind]}

${MAIL_CLOSE[kind]}

Warm regards,
{{company_name}} — Human Resources`,
    },
  }
})
