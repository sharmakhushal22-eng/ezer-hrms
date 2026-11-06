# LMS product research: self-paced enterprise learning

Researched 2026-11-01 for an India-focused HRMS (50-2,000 employees, no instructor-led training).
All 10 products are covered. Depth varies; see "Evidence quality" and "Could not verify".

## Evidence quality (read this first)

Tags on every bullet:

- **[fetched]** = WebFetch opened the page; the claim comes from that page's text.
- **[snippet]** = the page was NOT opened. The claim comes from the WebSearch tool's summary of that page. That
  summary is model-written, so treat wording as paraphrase and quotes as unconfirmed.
- **[inferred]** = my inference, not stated by the source.
- **[3rd-party]** = not a vendor source.

Fetch status per site:

| Site | Result | Consequence |
|---|---|---|
| help.talentlms.com | 403 on every attempt | All TalentLMS claims are [snippet] |
| help.docebo.com | 403 | All Docebo claims are [snippet] |
| docs.moodle.org | 403 | All Moodle claims are [snippet] |
| support.absorblms.com | 403 | All Absorb claims are [snippet] |
| support.learnupon.com | 403 | All LearnUpon claims are [snippet] |
| support.360learning.com | 403 | All 360Learning claims are [snippet] |
| marketplace.darwinbox.com | 403 | Darwinbox listing is [snippet] |
| help.keka.com/admin/* | Returned a sign-in page | Keka claims are [snippet] |
| help.sap.com PDFs | Returned an empty shell | SAP Help claims are [snippet]; learning.sap.com pages were opened |
| experienceleague.adobe.com | Opened | Adobe has the strongest evidence, with Workday |
| doc.workday.com | Opened | Workday has the strongest evidence, with Adobe |
| help.csod.com | Opened, with intermittent connection resets | Mix of [fetched] and [snippet] |
| help.zoho.com, greythr.com | Opened | Zoho and greytHR claims are mostly [fetched] |

No fetch workaround was attempted for refused sites, as briefed.

## Could not verify

- **All products:** a claim missing from a section means "not found", not "feature absent". Only explicit statements
  count as absent.
- **SAP SuccessFactors:** video completion rules, certificate templates, standard report names.
- **Cornerstone:** certificate templates, certificate verification, a pre-hire user state.
- **Workday:** offline learning on mobile, certificate templates, a compliance report by name.
- **LearnUpon:** overdue and compliance reports, question randomisation, whether the mobile app works offline.
- **Absorb:** certificate verification, a dedicated overdue report.
- **Docebo:** a per-video seek block for uploaded video, certificate QR verification.
- **Moodle:** enrolment approval in core, relative due dates in core.
- **360Learning:** video completion rule, seek blocking.
- **Adobe:** video seek blocking, external-to-internal conversion.
- **Darwinbox:** nearly everything beyond marketing pages.

---

## 1. TalentLMS

- **1 Hierarchy:** Course contains units, optionally grouped in sections; units plus sections are capped at 1,000. [snippet] https://help.talentlms.com/hc/en-us/articles/9651361074460-How-to-add-content-to-a-course-in-TalentLMS
- **1 Path entity:** Learning Paths need the Grow plan or above; completion can require all courses, a percentage, or specific courses. [snippet] https://help.talentlms.com/hc/en-us/articles/21712800370204-How-to-create-and-manage-Learning-Paths-in-TalentLMS
- **2 Quiz after video:** Yes, by placing a Test unit after a video unit. A video unit can also complete on a question, but that answer is not saved to reports, so the vendor says to add a short Test unit instead. [snippet] https://help.talentlms.com/hc/en-us/articles/360014572334-Why-can-t-you-review-the-unit-completion-questions
- **2 Sequencing:** In sequential order a learner who fails a test cannot advance; in free order they can. [snippet] https://help.talentlms.com/hc/en-us/articles/9652272657180-How-to-add-a-test-in-TalentLMS
- **2 Video completion:** Button, set period of time (can sync to video length, max 48 hours), or question. No percentage-watched or seek block found. [snippet] https://help.talentlms.com/hc/en-us/articles/27019267841308-How-to-work-with-video-units-in-TalentLMS
- **3 Completion:** All units (default), a percentage of units, selected units, or passing a selected test. [snippet] https://help.talentlms.com/hc/en-us/articles/9651377683100-How-to-set-completion-rules-for-courses-in-TalentLMS
- **3 Tests:** Pass score, shuffle questions and answers, repetitions (only if not passed, or always), delay between attempts, timer with auto-submit, control over showing correct answers. [snippet] https://help.talentlms.com/hc/en-us/articles/9652272657180-How-to-add-a-test-in-TalentLMS
- **3 Pass mark default:** 50% per a roughly 2,200-day-old blog post, so check it. [snippet] https://www.talentlms.com/blog/how-create-online-course-talentlms/
- **3 Question pool:** Randomised tests draw from a handpicked pool of at least 2 questions. [snippet] https://help.talentlms.com/hc/en-us/articles/9652319579932-How-to-create-a-randomized-test-in-TalentLMS
- **4 Groups are forward-only:** Courses added to a group do not reach existing members; bulk "Enroll users in group courses" does that. "Auto-enroll users to training" is off by default and covers new members, not newly added content. [snippet] https://help.talentlms.com/hc/en-us/articles/9651522442396-How-to-work-with-groups-in-TalentLMS
- **4 New joiners:** A default group auto-enrols new users in its courses and paths. [snippet] https://help.talentlms.com/hc/en-us/articles/9651391053212-How-to-assign-courses-to-users-upon-registration-in-TalentLMS
- **4 Automations:** "Z hours after user signup, assign course(s) Y"; on completion assign; reset and reassign around certificate expiry. No hire-date trigger found (signup date only). [snippet] https://help.talentlms.com/hc/en-us/articles/9651467215900-How-to-work-with-automations-in-TalentLMS
- **4 Due dates:** Time limit relative to enrolment, or a fixed timeframe for all learners. Minimum time limit is 0.1 days. [snippet] https://help.talentlms.com/hc/en-us/articles/9651386888092-How-to-work-with-time-limits-and-expired-courses-in-TalentLMS
- **5 Catalogue:** Per-course catalog toggle; hide the whole catalog from a user type via permissions. [snippet] https://help.talentlms.com/hc/en-us/articles/9651507252636-How-to-work-with-the-Course-Catalog
- **5 Approval:** Enrollment requests can be accepted or declined individually or in bulk; not available if the course has a price. [snippet] https://help.talentlms.com/hc/en-us/articles/18294487844764-How-to-work-with-course-enrollment-requests-in-TalentLMS
- **6 Roles:** Three roles (Administrator, Instructor, Learner); defaults are Admin-Type, Trainer-Type, Learner-Type; Legacy adds SuperAdmin. Custom types can mix roles. [snippet] https://help.talentlms.com/hc/en-us/articles/9652280520092-A-guide-to-the-TalentLMS-user-types
- **6 Separation:** A custom type can keep instructor permissions and drop course creation. [snippet] https://help.talentlms.com/hc/en-us/articles/360014574734-A-guide-to-TalentLMS-user-types-in-the-Legacy-interface
- **6 Review workflow:** None found; only an Active/inactive toggle and per-unit "Publish changes". [snippet] https://help.talentlms.com/hc/en-us/articles/360017627173-How-to-create-a-new-course-
- **7 Versioning:** No versions. Completers stay completed after edits; a manual "Synchronize" revokes completion for those missing new units; deleting and recreating a unit shows it incomplete for all. [snippet] https://help.talentlms.com/hc/en-us/articles/9651404539292-How-updating-course-content-affects-the-users-assigned-to-that-course-in-TalentLMS
- **7 Timeline:** Records a "Course update" event, which is an audit log, not version control. [snippet] https://help.talentlms.com/hc/en-us/articles/28747133348892-A-guide-to-the-TalentLMS-Timeline-events
- **8 Preboarding:** Branches are sub-portals with their own URL, login, signup method and default group, documented for external audiences. [snippet] https://help.talentlms.com/hc/en-us/articles/10730422734236-How-to-use-branches-for-multi-purpose-training-in-TalentLMS
- **8 Controls:** Restricted branches and a member cap that hides sign-up once reached. [snippet] https://help.talentlms.com/hc/en-us/articles/360014571494-How-to-set-a-limit-for-branch-members
- **8 Conversion:** Moving a user between branch types was not found.
- **9 Reports:** Users, Courses, Learning paths, Branches, Groups, Learning activities, Training matrix, Timeline, Custom, Analytics. No overdue-specific report found. [snippet] https://help.talentlms.com/hc/en-us/articles/9652242394780-What-types-of-reports-are-available
- **9 Reminders:** "X hours before course expiration" notification; users past deadline show an Expired label. [snippet] https://help.talentlms.com/hc/en-us/articles/9651467365916-How-to-send-reminders-for-completing-a-course-in-TalentLMS
- **9 Record survival:** Timeline exports still verify completions after a course is deleted. [snippet] https://help.talentlms.com/hc/en-us/articles/9651408197660-How-to-use-TalentLMS-for-compliance-training
- **10 Certificates:** Expiry in days or months or on a specific date; a public download URL needs no login; the last 20 per course are archived. No authenticity page found. [snippet] https://help.talentlms.com/hc/en-us/articles/9651316373148-How-to-work-with-certifications-in-TalentLMS
- **11 Mobile:** Native iOS and Android; offline for compatible content; YouTube and Vimeo cannot be saved. [snippet] https://www.talentlms.com/mobile

## 2. Moodle (core LMS, plus Moodle Workplace where noted)

- **1 Hierarchy:** Course contains sections, which contain activities and resources. Sections are confirmed by the app's section-level download. [snippet] https://docs.moodle.org/503/en/Moodle_app_offline_features
- **1 Path entity:** Core course prerequisites do not block access; they only stop the course being marked complete. [snippet] https://docs.moodle.org/503/en/Course_completion_FAQ
- **1 Workplace:** Programs and Certifications exist in Moodle Workplace, sold only through certified partners. [snippet] https://docs.moodle.org/403/en/Programs
- **2 Quiz after video:** A quiz is a separate activity and its completion can gate the next activity. [snippet] https://docs.moodle.org/501/en/Using_restrict_access
- **2 Video completion:** Core completion is per activity type (view, grade). Minimum watch duration needs the paid Video Time Pro plugin; no core option found. [snippet] https://docs.moodle.org/502/en/VideoTime
- **2 H5P:** Reports whether the student reached the end, separately from whether they scored 100%. [snippet] https://docs.moodle.org/503/en/H5P_activity
- **3 Pass rule:** "Require grade" and "Require passing grade" must both be ticked. With multiple attempts, a quiz can complete after all attempts are used, even if failed. [snippet] https://docs.moodle.org/502/en/Activity_completion_settings
- **3 Quiz settings:** Optional time limit, attempts overridable per group or user, enforced delay, grading method (highest, average, first, last). [snippet] https://docs.moodle.org/503/en/Quiz_settings
- **3 Banks:** Question bank plus random questions; shuffle is a separate option. Review options control what students see after an attempt. [snippet] https://docs.moodle.org/503/en/Quiz_activity
- **3 Gap:** Blocking retakes after a pass needs a third-party plugin. [snippet] https://docs.moodle.org/503/en/Quiz_FAQ
- **4 Cohort sync is dynamic:** Adding or removing a cohort member enrols or unenrols them. Manual enrolment of a cohort is one-time. [snippet] https://docs.moodle.org/503/en/Cohort_sync
- **4 Limits:** Cannot target a whole course category; teachers cannot add it by default (admin or Manager only); deleting a cohort unenrols members and loses some activity data. [snippet] https://docs.moodle.org/503/en/Cohorts_FAQ
- **4 Workplace dynamic rules:** Allocate to programs and certifications; dynamic rules ignore the allocation window. [snippet] https://docs.moodle.org/500/en/Programs_Configuration
- **4 Recurring:** Workplace recertification is due at the expiry of the previous certification; if missed, the user is reallocated to the initial program. [snippet] https://docs.moodle.org/403/en/Certifications
- **5 Catalogue:** Hidden courses stay out of listings for all but teachers and admins. Self-enrolment works with or without a key. Approval was not found. [snippet] https://docs.moodle.org/503/en/Course_enrolment
- **6 Roles:** Site administrator, Manager, Course creator, Teacher, Non-editing teacher, Student, Guest, Authenticated user. [snippet] https://docs.moodle.org/35/en/Standard_roles
- **6 Separation:** Course creator only creates courses; Non-editing teacher grades but cannot alter content; Manager is scopeable to site or category. [snippet] https://docs.moodle.org/502/en/Course_creator_role
- **6 Review workflow:** None found.
- **7 Versioning:** No course versioning found. After attempts, questions cannot be added to or removed from a quiz; the common workaround is to duplicate it (old doc). [snippet] https://docs.moodle.org/19/en/Editing_a_quiz
- **7 Question versions:** Moodle 4.0+ pins the question version at attempt start; a regrade can move it. [3rd-party forum] [snippet] https://moodle.org/mod/forum/discuss.php?d=436326
- **7 New intake:** Admins back up with users, then reset the course. Reset is irreversible and keeps activities. [snippet] https://docs.moodle.org/503/en/Year-end_procedures
- **8 Preboarding:** Guest role is read-only and key-protectable. No documented employee-conversion path found. [snippet] https://docs.moodle.org/503/en/Guest_role
- **9 Reports:** Timeline block shows overdue activities (dashboard shows at most 2 weeks back). [snippet] https://docs.moodle.org/503/en/Timeline_block
- **9 Quiz due date:** Moodle 5.3 separates due date from close date; attempts after due are marked overdue, not blocked. [snippet] https://docs.moodle.org/503/en/Quiz_settings
- **9 Site-wide report:** The site-wide completion report in the search results is a community plugin, not core. [snippet] https://docs.moodle.org/311/en/ad-hoc_contributed_reports
- **10 Certificates:** Custom certificate plugin has an expiry element shown on verification pages. [snippet] https://marketplace.moodle.com/plugins/1466/versions?show=all
- **10 Verification:** Workplace certificate manager adds code, link or QR, verifiable by unauthenticated users. [snippet] https://marketplace.moodle.com/plugins/tool_certificate
- **11 Mobile:** Native app with course, section and item download; offline work syncs later. Free plan allows 2 offline courses per device per site. [snippet] https://docs.moodle.org/503/en/Moodle_app_plans

## 3. Docebo

- **1 Hierarchy:** E-learning courses are collections of lessons, also called training materials. [snippet] https://help.docebo.com/hc/en-us/articles/360020080300-Creating-and-managing-e-learning-courses
- **1 Path entity:** Learning plans; new certifications are a type of learning plan. Legacy certifications are separate. [snippet] https://help.docebo.com/hc/en-us/articles/22057130562066-Certificates-and-certifications
- **2 Quiz after video:** Tests are training materials sequenced alongside video. [inferred] from https://help.docebo.com/hc/en-us/articles/360020083500-Managing-course-navigation-policy
- **2 Sequencing:** Three policies: free; sequential (complete and pass each item to unlock the next); first mandatory item then any order. [snippet] https://help.docebo.com/hc/en-us/articles/360020083500-Managing-course-navigation-policy
- **2 Prerequisites:** Set per training material; locked items show a padlock. [snippet] https://help.docebo.com/hc/en-us/articles/360020083540-Managing-training-material-settings-and-prerequisites
- **2 Video completion:** Fixed rule: complete 15 seconds before the end if over 150 seconds, otherwise at 90%. With a certain option on, learners can jump ahead and still complete. Only on-platform viewing is tracked. [snippet] https://help.docebo.com/hc/en-us/articles/360020128359-Uploading-and-converting-video-training-material
- **2 Creator lessons:** In sequential mode a video screen needs 100% playback; scrubbing to the end does not count. [snippet] https://help.docebo.com/hc/en-us/articles/26032328516114-Editing-lessons-with-the-Creator-tool
- **3 Tests:** Random order, or a random subset that changes per attempt and user; randomised answers; max attempts (0 = unlimited). If course and test limits both exist, the lower applies. [snippet] https://help.docebo.com/hc/en-us/articles/360020128139-Managing-test-options
- **3 Bank:** Global question bank reusable across tests and courses. [snippet] https://help.docebo.com/hc/en-us/articles/360020127999-Managing-the-question-bank
- **4 Enrollment rules:** Tie a group or branch to courses or learning plans. They fire only on addition; pre-existing members are not enrolled, and content later added to a rule does not reach current members. [snippet] https://help.docebo.com/hc/en-us/articles/360020128579-Activating-and-managing-the-Enrollment-rules-app
- **4 Learning plan exception:** A rule-enrolled user also receives courses later added to that plan. Rule enrolments can be rolled back from Logs. [snippet] https://help.docebo.com/hc/en-us/articles/360020128579-Activating-and-managing-the-Enrollment-rules-app
- **4 Automatic groups:** Fill by eligibility conditions, update in 0-15 minutes, and recalculation can re-trigger rules because members are briefly removed and re-added. [snippet] https://help.docebo.com/hc/en-us/articles/360020084100-Managing-groups
- **4 Due dates:** Validity counted from the enrolment date, starting at approval if pending. A soft deadline allows completion after validity ends. [snippet] https://help.docebo.com/hc/en-us/articles/18250951520018-Managing-learning-plans-properties
- **4 Recurring:** Recertification window and expiry on certifications; re-enrolment means re-earning. [snippet] https://help.docebo.com/hc/en-us/articles/24760406301330-Enrolling-users-in-learning-plans-and-certifications
- **5 Catalogue:** Card states free, moderated or locked. Learners see only assigned catalogs with internal-catalog courses that allow self-enrolment. A date window is possible. [snippet] https://help.docebo.com/hc/en-us/articles/12454488646418-Self-enrolling-in-courses-and-learning-plans-from-catalogs
- **5 Approval:** Moderated enrolment waits for approval; the learner sees the page but no lessons. Learning plans cannot be moderated. [snippet] https://help.docebo.com/hc/en-us/articles/360020084340-Managing-self-enrollments-and-waiting-lists
- **6 Roles:** Users, Power Users, Superadmins. Superadmin cannot be limited. [snippet] https://help.docebo.com/hc/en-us/articles/360020082940-User-levels-roles-and-statuses
- **6 Separation:** Power Users need a permission profile and a resource assignment; max 10 profiles. Authoring and enrolling are separable. [snippet] https://help.docebo.com/hc/en-us/articles/6463399445394-Power-User-permissions
- **6 Instructor:** A course instructor can evaluate assignments, which only matters if assignments are used. [snippet] https://help.docebo.com/hc/en-us/articles/360020128319-Managing-assignments-as-training-material
- **6 Review workflow:** None found.
- **7 Versioning:** Per training material: overwrite keeps learner status; a new version sends in-progress learners back to start while completers keep completion. [snippet] https://help.docebo.com/hc/en-us/articles/360020124619-Managing-the-Training-materials-page
- **7 Shared tracking:** Resetting material used in two courses resets it in both. [snippet] https://help.docebo.com/hc/en-us/articles/360020126719-Resetting-the-completion-of-training-material
- **7 History:** Archiving an enrolment resets tracking by default, with an opt-out. [snippet] https://help.docebo.com/hc/en-us/articles/11521889929490-Archiving-course-enrollments
- **8 Preboarding:** Extended Enterprise maps one branch to one client URL; catalogs can be per domain or public. Superadmin always sees everything. [snippet] https://help.docebo.com/hc/en-us/articles/360020124899-Managing-the-Extended-enterprise-app
- **8 New hires:** Docebo's own example is a "new hires" group feeding an onboarding plan. Conversion from external to employee was not found. [snippet] https://help.docebo.com/hc/en-us/articles/360020128579-Activating-and-managing-the-Enrollment-rules-app
- **9 Reports:** Custom reports include Users - Courses, Courses - Users, and Users - Course enrollment time (delay analysis of those past deadline). [snippet] https://help.docebo.com/hc/en-us/articles/360020125499-Available-custom-reports-types
- **9 Manager view:** My team dashboards for direct reports, with an overdue status covering overdue or due within 14 days. [snippet] https://help.docebo.com/hc/en-us/articles/29543826719378-Courses-and-Learning-Plans-dashboards-in-My-team
- **10 Certificates:** Templates with background and dynamic tags; default per course plus up to 50 per branch or group; certificate number tag; one template per learning plan. QR verification not found. [snippet] https://help.docebo.com/hc/en-us/articles/360020084280-Creating-and-managing-certificates
- **11 Mobile:** Native Go.Learn (iOS, Android). Offline supports SCORM, uploaded video, slides, files and HTML; tests, surveys, xAPI and LTI do not work offline. [snippet] https://help.docebo.com/hc/en-us/articles/360020080020-Working-with-content-on-your-Go-Learn-mobile-app
- **Note:** Darwinbox resells a Docebo-based LMS (see Indian HRMS section).

## 4. SAP SuccessFactors Learning

- **1 Hierarchy:** Items sit in Curricula (items, requirements, subcurricula) or Programs (agenda with activities and sections). The two cannot be nested in each other. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-administration/introducing-programs
- **1 Curriculum vs program:** Curricula support retraining and status over time; programs do not. Programs show as one card; curriculum items appear individually. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-administration/introducing-programs
- **2 Quiz after video:** Assessments attach to learning items; a video-then-quiz sequence inside an item was not confirmed. [snippet] https://help.sap.com/docs/SAP_SUCCESSFACTORS_LEARNING/b01cdf14a9eb4dc1bd4d0c6460247699/2978e3a2900f4ef392d7eeefe982a217.html
- **2 Sequencing:** Programs sequence by sections, curricula by prerequisites. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-administration/introducing-programs
- **2 Item completion:** Occurs after all objects in the item's content structure are complete. [snippet] https://help.sap.com/doc/844cba6db4b0477e92867df6c24a2109/2405/en-US/SF_Admin_Help_en.pdf
- **3 Exams:** Question pools per objective with passing percentage; users may get different question sets. Exam Attempts Limit, 0 = unlimited. [snippet] https://help.sap.com/docs/SAP_SUCCESSFACTORS_LEARNING/b01cdf14a9eb4dc1bd4d0c6460247699/d81023e691db4f87b6f5bff4566b013b.html
- **3 Quizzes:** Pass percentage, attempts limit; 0% gathers data without pass or fail. Questions cannot join the Question Library or be reused. [snippet] https://help.sap.com/docs/successfactors-learning/creating-assessments-to-test-users-learning/quiz-settings
- **3 Completion link:** "Add to History on Pass" completes the item; "on Failure" marks it failed. [snippet] https://help.sap.com/doc/d5fdf1a4115a4916bd7cc6e0e450f1e9/2405/en-US/LRN_Assessments.pdf
- **4 Manual:** Free-floating items are one-time assignments that ignore retraining defaults and appear even if previously completed. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-administration/assigning-learning-needs-to-users-manually-1
- **4 Dynamic:** Assignment Profiles select users by attribute rules (AND within a group, OR across). A scheduled process picks up later matches. Deactivating a profile stops new assignments; existing ones stay unless unassigned. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-academy/assigning-learning-needs-to-users-automatically-1
- **4 Duplicates:** Each profile is separate, so one user in two profiles containing the same course can get it twice. [snippet] https://userapps.support.sap.com/sap/support/knowledge/en/2407100
- **4 Due dates:** Period-based. Event basis ("10 days after assigned") or calendar basis (fixed date, with a grace threshold). [fetched] https://learning.sap.com/courses/sap-successfactors-learning-academy/using-period-based-settings-to-set-due-dates-1
- **4 Recurring:** Retraining works only through curricula; item-level settings are defaults. "Ignore Previous Completions Older Than" invalidates old history. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-academy/using-period-based-settings-to-set-due-dates-1
- **5 Catalogue:** Libraries are made available for self-assignment only through assignment profiles. [snippet] https://learning.sap.com/courses/sap-successfactors-learning-academy/making-programs-available-to-users
- **5 Approval:** Approval roles attach to items through an approval process. [snippet] https://learning.sap.com/courses/sap-successfactors-learning-academy/managing-the-approval-process
- **6 Roles:** No fixed list. Security roles combine rules, restrictions, permissions and security domains; admin roles add entity, function and permission restrictions. [snippet] https://help.sap.com/doc/bc537e5a766543638431c888a8294e8a/2511/en-US/Learning-Management-Config-Guide-2Q3.pdf
- **6 Separation:** Item, curriculum and program permissions sit in Learning Activities; profile management has its own role. Authoring and assigning are separable. [snippet] https://learning.sap.com/courses/sap-successfactors-learning-academy/creating-an-administrator-role
- **6 Review workflow:** None found.
- **7 Revisions:** The wizard asks whether to update affected learning plans and curricula; the effective date controls when the new revision counts in status. [snippet] https://learning.sap.com/courses/sap-successfactors-learning-administration/revising-an-item-1
- **7 Grandfathering:** Under an effective date, users already complete stay complete until that date, then become incomplete without the new assignment. [fetched] https://learning.sap.com/courses/sap-successfactors-learning-academy/using-period-based-settings-to-set-due-dates-1
- **7 Keep retraining:** A KBA covers keeping the retraining cycle across revisions; its detail was not read. [snippet] https://userapps.support.sap.com/sap/support/knowledge/en/2549031
- **8 Pre-joiners:** Learning courses can be assigned in Onboarding and accessed before the start date. [snippet] https://learning.sap.com/courses/sap-successfactors-onboarding-academy/integrating-sap-successfactors-onboarding-and-sap-successfactors-learning_f451d67f-e2d1-4e88-a601-4ed176dc423a
- **8 Mechanics:** New hires sync to the LMS on a schedule; needs allowFutureHireDates and Learning access on the Onboarding External User role. [SAP Community blog] [snippet] https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/onboarding-learning-integration-for-pre-day1-new-hires/ba-p/13508162
- **8 External:** Extended-enterprise users hold a single Learning account and cannot reach Learning Administration. [snippet] https://help.sap.com/doc/187bb4b0dcfa4cdcb4e571abb98b685a/2511/en-US/SF_LRN_Extended_Enterprise.pdf
- **9 Reports:** Standard report names were not verified. User Learning Plan Audit Report shows which automatic process removed an item. [snippet] https://userapps.support.sap.com/sap/support/knowledge/en/2075363
- **9 Supervisors:** Can record completions for learning done outside the system. [snippet] https://help.sap.com/doc/2c7f2a0453644bb79fc618b93d62a6c9/2505/en-US/SF_LRN_Approvals_Impl.pdf
- **10 Certificates:** Only a course title "Managing Certificates of Completion" surfaced; details unverified.
- **11 Mobile:** Native app; My Downloads offers SCORM 1.2, AICC, AICC Wrapper and Document, not SCORM 2004. Admin controls per item. [snippet] https://community.sap.com/t5/human-capital-management-blog-posts-by-sap/changes-to-android-offline-learning-offline-coming-in-february/ba-p/14293925

## 5. Cornerstone OnDemand

- **1 Hierarchy:** Learning objects (online course, video, test, material, ILT) group into a curriculum, which acts as a single learning object and can have sections. [fetched] https://help.csod.com/help/csod_0/Content/Catalog/Curriculua_Administration/Curricula_Overview.htm
- **1 Certification:** A separate entity that runs in periods with expiry and past-due dates. [snippet] https://help.csod.com/help/csod_0/Content/Certifications_and_Forms/Certifications_2/Certification_Administration.htm
- **2 Quiz after video:** Tests are learning objects inside a curriculum, so one can follow a video. [inferred] from https://help.csod.com/help/csod_0/Content/Catalog/Curriculua_Administration/Curricula_Overview.htm
- **2 Sequencing:** Admins set display order and completion order per item and per section, or let learners choose within a section. [fetched] https://help.csod.com/help/csod_0/Content/Catalog/Curriculua_Administration/Curricula_Overview.htm
- **2 Video completion:** Auto-complete when progress reaches full duration; the percentage cannot be configured. [snippet] https://help.csod.com/help/csod_0/Content/Preferences/Learning_Preferences/Learning_Feature_Activation_Preferences.htm
- **3 Test settings:** Passing score defaults to 80% if blank; Attempts Allowed blank = unlimited; a passer cannot retake; time limit up to 300 minutes; randomise sections and questions. [snippet] https://help.csod.com/help/csod_0/Content/Content/Test_Engine/Create_a_Test/Create_a_Test_General.htm
- **3 Bank:** Questions must come from the Question Bank; subset selection per section. [snippet] https://help.csod.com/help/csod_0/Content/Content/Test_Engine/Create_a_Test/Create_a_Test_Structure.htm
- **4 Dynamic assignment:** Standard is one-time. Dynamic assigns ongoing to users who meet criteria, processing daily or annually; new hires go through a dynamic group of recently hired users. [fetched] https://help.csod.com/help/csod_0/Content/Learning_Assignment_Tool/Learning_Assignment_Use_Cases/Dynamic_Learning_Assignment_-_Create.htm
- **4 Due dates:** None, relative (recommended for daily processing), or annual date. [fetched] https://help.csod.com/help/csod_0/Content/Learning_Assignment_Tool/Learning_Assignment_Use_Cases/Dynamic_Learning_Assignment_-_Create.htm
- **4 Recurrence:** Relative Date, Annually, Never, Specific Date, or a number of transcript occurrences; daily processing catches up missed recurrences. [snippet] https://help.csod.com/help/csod_0/Content/Learning_Assignment_Tool/Learning_Assignment_Use_Cases/Dynamic_Recurring_Learning_Assignment_-_Create.htm
- **4 Removal:** Dynamic reassignment returns training only if dynamic removal took it away, not after manual removal. It is off by default at portal level. [fetched] https://help.csod.com/help/csod_0/Content/Learning_Assignment_Tool/Dynamic_Reassignment/Dynamic_Reassignment_Overview.htm
- **5 Catalogue:** With no availability set, no user can access training independently, yet managers and admins can still assign it. [snippet] https://help.csod.com/help/csod_0/Content/Catalog/Course_Catalog/Course_Catalog_Availability.htm
- **5 Approval:** Pre-Approved exempts OUs; Register Upon Approval skips the Register click. [snippet] https://help.csod.com/help/csod_0/Content/Catalog/Setting_Availability/Set_Availability_by_Organization_Unit.htm
- **6 Roles:** Hierarchy rooted at System Administrator. Manager is auto-assigned to anyone listed as a manager, with permissions constrained to subordinates. [snippet] https://help.csod.com/help/csod_0/Content/System_Configuration/Security_Roles/Security_Roles_Overview.htm
- **6 Separation:** Version creation (Course Catalog - Update), upload (Online Class - Upload) and publish (Online Class Version - Publish) are separate permissions. [fetched] https://help.csod.com/help/csod_0/Content/Learning_Admin/Learning_Compliance/201/Online_Course_Versioning/Apply_Previous_Version.htm
- **6 Review workflow:** No content review step found, but the separate publish permission above could serve as a gate. [inferred] from the same page.
- **7 Versioning:** Statuses group into Not Started, In Progress and Completed equivalents; users in each can receive the new version depending on the admin's selections. [fetched] https://help.csod.com/help/csod_0/Content/Content/Content_Uploader/Online_Course_Versioning/Online_Course_Versioning_-_Status_Equivalents.htm
- **7 Append:** Lets two versions coexist and both be assigned. [snippet] https://help.csod.com/help/csod_0/Content/Preferences/Learning_Preferences/Online_Course_Versioning_Preferences.htm
- **7 Due dates:** "Apply Previous Version Due Date Criteria" carries old rules forward; Requires Retraining re-adds users. [fetched] https://help.csod.com/help/csod_0/Content/Learning_Admin/Learning_Compliance/201/Online_Course_Versioning/Apply_Previous_Version.htm
- **7 Curriculum:** Choosing not to maintain progress resets LOs to Not Started; if no status is selected, only later registrants get the new version. [snippet] https://help.csod.com/help/csod_0/Content/Catalog/Curriculua_Administration/Curriculum_-_Reversion_-_Confirm.htm
- **8 External:** Extended Enterprise targets customers and partners, with self-registration groups and approvals. [snippet] https://help.csod.com/help/csod_0/Content/Extended_Enterprise/Self_Registration/Self_Registration_-_Approve_Pending_User_Records.htm
- **8 Pre-hire:** No pre-hire state or conversion found.
- **9 Reports:** Past Due Report for subordinates (admins see all), with date, type and provider filters. [snippet] https://help.csod.com/help/csod_0/Content/Reporting/Standard_Reports/Track_Employees/Past_Due.htm
- **9 Summary:** Training Status Summary covers direct reports. [snippet] https://help.csod.com/help/csod_0/Content/Reporting/Standard_Reports/Track_Employees/Training_Status_Summary.htm
- **9 Aging:** Reporting 2.0 has a Past Due Aging filter (X days past due). [snippet] https://help.csod.com/help/csod_0/Content/Reporting/Reporting_2-0/Create_Report.htm
- **10 Certificates:** The Certification entity is documented (see 1 above); certificate templates and verification were not found.
- **11 Mobile:** Cornerstone Learn app; offline needs a portal preference and per-object enablement. [snippet] https://help.csod.com/help/csod_0/Content/Preferences/System_Preferences/Offline_Preferences_by_Division.htm

## 6. Absorb LMS

- **1 Hierarchy:** Online course syllabus has chapters and lessons. Curricula and course bundles sit above courses. [snippet] https://support.absorblms.com/hc/en-us/articles/22618733550483-How-to-Create-an-Online-Course
- **2 Quiz after video:** Assessment is a lesson type. To force a specific order across items, they go in different chapters. [snippet] https://support.absorblms.com/hc/en-us/articles/360052964634-An-Introduction-to-Learning-Objects
- **2 Video completion:** Complete once watched to the end. With Disable Seeking off (default), skipping to the end completes it. With it on, learners seek only within what they watched; optional free seek after completion. Absorb says this cannot be enforced 100% due to HTML5 limits. [snippet] https://support.absorblms.com/hc/en-us/articles/18767076921491-Disable-Video-Seeking
- **3 Assessments:** Grade to Pass 0-100%; weight 0-500; exam mode counts to the final score, quiz mode does not. Max attempts blank or 0 = unlimited; highest or first passing grade. [snippet] https://support.absorblms.com/hc/en-us/articles/11178329333779-Assessment-Learning-Object
- **3 Failure handling:** Allow Failure offers Do Nothing, Allow Retake After, or Reset All Lessons. [snippet] https://support.absorblms.com/hc/en-us/articles/360053812073-Configuring-Assessment-Survey-Questions
- **3 Bank:** Question banks are reusable, delivered sequentially or randomly; settings randomise order and show correct answers. [snippet] https://support.absorblms.com/hc/en-us/articles/360053812073-Configuring-Assessment-Survey-Questions
- **4 Rules:** Automatic Enrollment Rules on the course, by department, location, job role or group, or all learners. They re-evaluate on course publication and on profile change. [snippet] https://support.absorblms.com/hc/en-us/articles/360053094693-Automatic-Enrollment-Rules
- **4 Trap:** A learner manually unenrolled may be re-enrolled if they still match. [snippet] https://support.absorblms.com/hc/en-us/articles/221616948-Why-was-a-User-Re-Enrolled-in-a-Course
- **4 Due vs expiry:** Expiration removes access; Due Date keeps access but flags lateness. Expiry can be a date or a period after enrolment. [snippet] https://support.absorblms.com/hc/en-us/articles/19348998331795-Absorb-FAQs-Resolving-15-Common-Support-Inquiries
- **4 Recurring:** Allow Re-enrollment fires a set time after completion, or before certificate expiry. [snippet] https://support.absorblms.com/hc/en-us/articles/219544607-Re-Enrollment-Re-Certification
- **4 Automation:** Rules plus re-enrollment give annual cycles; a certificate expiring next day causes immediate re-enrolment. [snippet] https://support.absorblms.com/hc/en-us/articles/360053178033-How-To-Automate-Course-Re-Enrollment
- **4 History:** Curriculum re-enrolment sets existing enrolments to historic. [snippet] https://support.absorblms.com/hc/en-us/articles/22943771271571-Overview-of-Curriculum-Settings
- **5 Catalogue:** Self Enrollment is Off, Specific, or All Learners. Admin enrolment bypasses rules and prerequisites. [snippet] https://support.absorblms.com/hc/en-us/articles/22629067079059-Overview-of-Online-Course-Settings
- **5 Approval:** None, Course Editor, Supervisor, Administrator, Other; automatic enrolment skips approval. [snippet] https://support.absorblms.com/hc/en-us/articles/22629067079059-Overview-of-Online-Course-Settings
- **5 New:** A November 2026 Course Audiences release applies different rules per audience. [snippet] https://support.absorblms.com/hc/en-us/articles/56719416046355-November-2026-Release-Course-Audiences-One-course-the-right-rules-for-every-audience
- **6 Roles:** Default admin roles: System Admin, Admin, Instructor, Reporter (plus Create Editor if purchased). Not editable, but they can be duplicated. [snippet] https://support.absorblms.com/hc/en-us/articles/360053227673-Admin-Roles-Permissions
- **6 Separation:** Scope (All, Group, Department) is set on the user, not the role, and caps it. Custom roles cannot exceed the creator's. [snippet] https://support.absorblms.com/hc/en-us/articles/30677307992723-How-To-Create-a-Custom-Administrator-Role
- **6 Review workflow:** None found; Active/Inactive status only.
- **7 Versioning:** A new version is a label only. Replacing content makes Not Started and In Progress learners restart on the newest content; completers are unaffected unless they relaunch. No rollback; prior content is not stored. [snippet] https://support.absorblms.com/hc/en-us/articles/220313668-Course-Versioning
- **7 Retroactivity:** A dedicated article tabulates which edits reach enrolled learners (title yes; expiry applies at completion, not to past completers). [snippet] https://support.absorblms.com/hc/en-us/articles/38852556283539-Retroactive-Changes-in-Absorb-LMS
- **8 Preboarding:** Each user has exactly one department and many groups. Absorb recommends Internal and External departments under the top level. [snippet] https://support.absorblms.com/hc/en-us/articles/43617074500627-Department-Group-Structure-Best-Practices
- **8 Conversion:** Change department on Edit User, in bulk from Users Report, or by import. Rules then re-evaluate on the profile change. [inferred from the two sources] [snippet] https://support.absorblms.com/hc/en-us/articles/4407928382483-User-Management
- **8 Routes:** A department can have its own portal route, requested from Absorb. [snippet] https://support.absorblms.com/hc/en-us/articles/5335232968723-Department-Creation-Management
- **9 Reports:** Course Enrollments and User Enrollments show a Due Date column; no dedicated overdue report found. [snippet] https://support.absorblms.com/hc/en-us/articles/19348998331795-Absorb-FAQs-Resolving-15-Common-Support-Inquiries
- **9 Other:** Learner Progress and Course Activity reports exist. [snippet] https://support.absorblms.com/hc/en-us/articles/1500004929122-Learner-Progress-Report
- **10 Certificates:** Per-course toggle with expiration; changing expiry never affects past completers. Verification not found. [snippet] https://support.absorblms.com/hc/en-us/articles/22629067079059-Overview-of-Online-Course-Settings
- **11 Mobile:** Native iOS and Android. Offline supports uploaded files, assessments, surveys, SCORM; URL-based video is not supported; per-course download toggle. [snippet] https://support.absorblms.com/hc/en-us/articles/4409390829843-Absorb-Learning-Mobile-App

## 7. 360Learning

- **1 Hierarchy:** Course contains activities; Path contains steps and can include subpaths. A path session is a dated instance used to enrol and track. [snippet] https://support.360learning.com/hc/en-us/articles/9194138706324-Platform-glossary
- **2 Quiz after video:** Questions are added as activities in the course editor, so one can follow a video activity. [snippet] https://support.360learning.com/hc/en-us/articles/115001513506-Add-a-question-to-a-course
- **2 Sequencing:** Linear paths block on attempt limits; the learner must be unenrolled and re-enrolled in another session. Non-linear paths continue. [snippet] https://support.360learning.com/hc/en-us/articles/4402930736788-Set-up-a-SCORM-file-to-allow-several-attempts-in-a-session
- **2 Video:** No must-watch rule found. Screen suspends after 30 minutes of inactivity, so keep videos under 30 minutes. [snippet] https://support.360learning.com/hc/en-us/articles/360046047571-Understanding-activity-suspension-rules
- **3 Randomised:** "Random questions" moves questions to the end of the course and can show a subset per learner. [snippet] https://support.360learning.com/hc/en-us/articles/4402568834964-Display-randomized-questions-in-a-course
- **3 Path score:** Average of mandatory steps; success requires all mandatory steps plus the minimum score in each. [snippet] https://support.360learning.com/hc/en-us/articles/360056839331-Track-detailed-statistics-for-one-path
- **3 Reuse:** "Reuse question" imports questions; "Keep link" decides whether edits flow back. [snippet] https://support.360learning.com/hc/en-us/articles/115001513506-Add-a-question-to-a-course
- **4 Dynamic:** Audience Builder auto-enrols those who meet criteria; a separate choice unenrols non-matchers. Groups created after the audience are not added. [snippet] https://support.360learning.com/hc/en-us/articles/16740167802388-Enroll-learners-in-a-path-session
- **4 New joiners:** An Everyone audience adds new learners when "Audience dynamically updated" is on. [snippet] https://support.360learning.com/hc/en-us/articles/4404688221588-Create-a-path-session
- **4 Due dates:** Relative step due dates from enrolment; access continues after they pass. [snippet] https://support.360learning.com/hc/en-us/articles/360056138772-Create-a-path
- **4 Recurring:** Automatic re-enrolment based on last completion or on certificate expiry, requires Audience Builder, runs on a periodic cycle. [snippet] https://support.360learning.com/hc/en-us/articles/27543184641940-Set-up-automatic-re-enrollment-on-paths
- **5 Catalogue:** Admins and coaches publish a course into a group catalog with an In catalog toggle. Courses are not visible to learners until placed in a catalog or library. [snippet] https://support.360learning.com/hc/en-us/articles/360055043611-Publish-a-course-in-the-catalog-of-a-group
- **5 Approval:** Enrollment approval not found.
- **6 Roles:** Learner, Coach (tracks, enrols via sessions), User admin, Editor, Contributor, Group admin, Platform admin. Roles are per group and do not cascade except group admin. [snippet] https://support.360learning.com/hc/en-us/articles/360051774011
- **6 Separation:** Yes by design: creating a path and enrolling needs contributor or editor plus coach. [snippet] https://support.360learning.com/hc/en-us/articles/360051774011
- **6 Review workflow:** The only vendor here with one: project courses have reviewers who leave internal comments and click Complete Review. [snippet] https://support.360learning.com/hc/en-us/articles/4416209057172-Review-a-project-course
- **6 Draft state:** Removed in 2021; courses are Active at creation and hidden until placed in a catalog. [snippet] https://support.360learning.com/hc/en-us/articles/7799814928532-Release-Notes-2021
- **7 Versioning:** On-demand feature, up to 20 versions, not for SCORM. Learners who have not started see the latest; in-progress learners keep their version until the next attempt. Forcing replay means copying the course into the path. [snippet] https://support.360learning.com/hc/en-us/articles/36368237265300-Create-a-new-version-of-a-course
- **8 Preboarding:** Self-registration on a group by link plus security code, for users without an account. Needs the extended solution. [snippet] https://support.360learning.com/hc/en-us/articles/360060388251-Enable-self-registration-on-a-group
- **8 Expiring accounts:** Marketing mentions an automatic deletion date for external learners. [snippet] https://360learning.com/use-cases/customer-training/
- **8 Conversion:** Not found.
- **9 Reports:** User statistics show certificates as Valid, Expiring soon (30 days) or Expired. [snippet] https://support.360learning.com/hc/en-us/articles/360013715312-Track-user-statistics
- **9 Late flag:** Learners re-enrolled after their due date stay enrolled and show as late in dashboards. [snippet] https://support.360learning.com/hc/en-us/articles/27543184641940-Set-up-automatic-re-enrollment-on-paths
- **9 Certificates stats:** Available to platform admins, group admins and coaches, web app only. [snippet] https://support.360learning.com/hc/en-us/articles/19293021346964-Track-the-statistics-for-path-certificates
- **10 Certificates:** Path certificates with expiry; external certificates can be uploaded, optionally validated by a manager. [snippet] https://support.360learning.com/hc/en-us/articles/38218924340628-Upload-external-certificates
- **11 Mobile:** Native app; courses and paths download offline. Scores are not computed on device; mandatory eLearning must finish online. [snippet] https://support.360learning.com/hc/en-us/articles/115004610006-Download-courses-and-paths-on-the-mobile-app-to-play-them-offline

## 8. LearnUpon

- **1 Hierarchy:** Course contains modules. Learning paths group courses; learning journeys offer stricter ordering and support licensed courses, which paths do not. [snippet] https://support.learnupon.com/hc/en-us/articles/360004041437-Learning-paths-create-a-path-add-courses-set-progression-and-publish
- **2 Quiz after video:** Exam modules can follow video modules in a sequenced course. [inferred] from https://support.learnupon.com/hc/en-us/articles/360004040317-Courses-sequence-your-modules
- **2 Sequencing:** "Sequence your content" stops skipping; each module must be completed or passed before the next. Assignments, checklists and eSignature can bypass this. [snippet] https://support.learnupon.com/hc/en-us/articles/360004040317-Courses-sequence-your-modules
- **2 Video completion:** Video tracking sets a required percentage to view before the module completes. No separate seek block found. [snippet] https://support.learnupon.com/hc/en-us/articles/4405784775185-Courses-make-course-modules-mandatory-for-completing-a-course
- **3 Exams:** Passing score required before publish; attempts capped or unlimited; retake after passing optional; best or latest score. [snippet] https://support.learnupon.com/hc/en-us/articles/360004738158-Exam-options
- **3 Course pass mark:** With 2+ scored modules the mark is an average; without it, failing one exam fails the course. [snippet] https://support.learnupon.com/hc/en-us/articles/360021175418-Courses-set-a-course-pass-mark
- **3 Knowledge check:** Exam score can be excluded from the outcome. [snippet] https://support.learnupon.com/hc/en-us/articles/360006595858-Courses-evaluate-learners-with-scored-modules
- **3 Bank:** Question pools are added to exams. Randomisation was not confirmed. [snippet] https://support.learnupon.com/hc/en-us/articles/360004738778-Exams-create-an-exam
- **4 Dynamic rules:** Filters (email domain, creation date, custom data) place users in groups. Group courses enrol new members automatically; removal from a group unenrols them. [snippet] https://support.learnupon.com/hc/en-us/articles/360016528037-Dynamic-rules-overview
- **4 Due dates:** Advisory due date plus firm valid period; each by days after enrolment or calendar date. Group due dates apply only from that enrolment onward. [snippet] https://support.learnupon.com/hc/en-us/articles/360004040977-Manage-course-due-dates-and-valid-periods
- **4 Recurring:** Certificate validity plus "Auto re-enroll learner" N days before expiry; countdown starts only after passing; re-enrolment uses the latest version. [snippet] https://support.learnupon.com/hc/en-us/articles/360004011698-Recertify-your-learners
- **5 Catalogue:** "Display course in catalog", optional approval by admin or group manager, and restriction by group. Not for journeys. [snippet] https://support.learnupon.com/hc/en-us/articles/360004011758-Catalog-add-courses-learning-paths-and-learning-journeys-to-the-internal-catalog
- **6 Roles:** Learner, Instructor, Manager, Admin. Only admins change user types. No course-creator type; creation is a permission. [snippet] https://support.learnupon.com/hc/en-us/articles/360002353437-Collection-user-types-and-permissions
- **6 Instructor:** Leads courses and does not create by default; marks, resets exam attempts, reports on own courses. [snippet] https://support.learnupon.com/hc/en-us/articles/6961005256093-User-types-and-permissions-instructors
- **6 Manager:** Handles learners and groups; optional instructor-level rights allow creating courses. [snippet] https://support.learnupon.com/hc/en-us/articles/360011342458-Managers-set-permissions-to-manage-groups
- **6 Ownership:** Creator is course owner; ownership can move to anyone with create rights. [snippet] https://support.learnupon.com/hc/en-us/articles/7811546145693-Courses-course-owners-and-module-owners-explained
- **6 Review workflow:** Draft, Published and Under Revision statuses exist; a review step was not found. [snippet] https://support.learnupon.com/hc/en-us/articles/360002798938-Course-statuses
- **7 Versioning:** The strongest explicit model found. Auto-numbered versions; the system prompts when a change needs one (add or remove modules, exam questions, significant SCORM). Old version goes Under Revision and stays open for enrolment. [snippet] https://support.learnupon.com/hc/en-us/articles/360006552578-Publish-a-new-version-of-a-course
- **7 In-flight:** Publishing asks whether to move Not Started and In Progress learners. Moved in-progress learners restart. Completers keep their record. Old version is archived, reportable, closed to new enrolment. [snippet] https://support.learnupon.com/hc/en-us/articles/360006552578-Publish-a-new-version-of-a-course
- **7 Trap:** Learning journeys do not update automatically; each enrolment gets a new ID, so deeplinks break. [snippet] https://support.learnupon.com/hc/en-us/articles/360006552578-Publish-a-new-version-of-a-course
- **8 Preboarding:** Sub-portals exist; LearnUpon Anywhere embeds courses per portal. A pre-joiner flow was not found. [snippet] https://support.learnupon.com/hc/en-us/articles/18314839521693-LearnUpon-Anywhere-getting-started
- **9 Reports:** Learners export own training history as PDF or CSV. Overdue and compliance reports unverified. [snippet] https://support.learnupon.com/hc/en-us/articles/10031983586333-Learner-view-training-history-download
- **10 Certificates:** Course and path certificates exist with validity days; template detail unverified. [snippet] https://support.learnupon.com/hc/en-us/articles/360004011698-Recertify-your-learners
- **11 Mobile:** Native iOS and Android for learners, instructors, managers and admins. Offline settings exist on portal, but app use of them unconfirmed. [snippet] https://support.learnupon.com/hc/en-us/articles/21852060450973-Mobile-LearnUpon-s-app-for-iOS-and-Android

## 9. Adobe Learning Manager

- **1 Hierarchy:** Course contains modules (Content, Prework, Testout). Each course has a default instance. Learning paths and certifications sit above. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **2 Quiz after video:** Modules can be ordered, so a quiz module can follow a video module. [inferred] from https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **2 Sequencing:** Ordered or Unordered; Mandatory Modules count sets how many must be taken. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **2 Video completion:** Video is static content; completion is "On Launching content" or "Based on the Minimum percent required". Static content has no success criteria. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/content-library
- **3 Quiz rules:** Module completes on Quiz passed, Quiz attempted, or Quiz passed or limit reached. A learner can complete a module while its success criteria stay unmet. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/content-library
- **3 Attempts:** Infinite or fixed; a lock time blocks reattempts until elapsed; attempt time limit auto-ends; gradebook uses latest or highest. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **3 Pass:** Aggregate passing value; 0 means required-module completion alone. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **3 Banks:** Not verified. Quizzes rely on authored content, so bank and randomisation depend on that content. [inferred]
- **4 Manual:** Enrol from a course page by instance, users and groups; CSV up to 100,000. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/courses
- **4 Rules:** Learning Plans fire on new learner, added to or removed from group, completes training, fails a module, achieves skill, or on a date. New plans are disabled by default. Group triggers can include existing members. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/learning-plans
- **4 Unenrol:** "Unenroll from training" is an action on most triggers. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/learning-plans
- **4 Due dates:** Instance completion deadline, plus a day delay on trigger; certifications have "Days to complete". [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/courses
- **4 Recurring:** Certifications are Perpetual or Recurring (1, 2 or 3 years), with validity in months and reassignment from completion or enrolment date. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/certifications
- **5 Catalogue:** Disable the default catalog and create custom ones shared by user group. Internal and external sharing are mutually exclusive per catalog. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/catalogs
- **5 Approval:** Enrolment types: Self-enrolled, Manager approved, Manager nominated. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **5 Constraint:** Learning programs accept only self-enrolled courses. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/learner/learning-programs
- **6 Roles:** Administrator, Author, Instructor, Manager, Learner, Integration Administrator; custom roles scoped by group or catalog. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/user-management/add-users-user-groups
- **6 Separation:** Author is a distinct role; custom admin scope is in the security guide. A whitepaper lists six roles and omits Manager, so sources disagree. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/introduction/admin-security-framework/alm-secure-administration-guide
- **6 Review workflow:** Docs do not describe one. Reviewers exist only for checklists. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/content-library
- **7 Versioning:** The clearest three-way choice found: "Update all Learners now" (in-progress reset now), "Update all Learners eventually" (after current version), "Update only not started Learners". Completers move and reset under the first two; they stay under the third. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/content-library
- **7 Republish:** Replacing a module keeps progress on others but requires the new module. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/authors/courses
- **8 Preboarding:** External registration profile gives a URL with seat limit, expiry, allowed domains, email verification and inactivity removal; login by any email. Conversion to internal is not described. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/user-management/add-users-user-groups
- **9 Reports:** Completion, time spent, skills, effectiveness; Excel, CSV and email subscriptions; learner transcripts. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/admin/reports
- **9 Manager view:** Compliance Dashboard counts non-compliant, approaching deadline (under 30 days), safe (over 30 days), fully compliant, not enrolled; bulk email; download. [fetched] https://experienceleague.adobe.com/en/docs/learning-manager/using/manager/manager-dashboard
- **10 Certificates:** Custom certificates have a drag-and-drop editor and dynamic fields. Verification not found. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/introduction/whats-new
- **11 Mobile:** Native app, but offline evidence conflicts: guide says tablets, FAQ says smartphones too, release notes list open offline bugs. Treat as partial. [snippet] https://experienceleague.adobe.com/en/docs/learning-manager/using/learner/ipad-android-tablet-users

## 10. Workday Learning

- **1 Hierarchy:** Topic on everything; standalone lesson; course with course lessons; course offering (blended only); program over existing lessons and courses. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/workday-learning-components.html
- **1 Lesson tracking:** Single lessons are not tracked alone; Workday suggests a single-lesson course. [snippet] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/nai1606143525797.html
- **1 Sana:** Workday Learning, Powered by Sana reached general availability on 22 July 2026 and has its own authoring. [snippet] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/workday-learning-powered-by-sana/setup-considerations--workday-learning-powered-by-.html
- **2 Quiz after video:** Yes, and uniquely inside the video: Media Cloud interactions (multiple choice, open response, checkbox) sit on the timeline. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/workday-drive-and-media-cloud.html
- **2 Sequencing:** Enforce Lesson Order, with at least 2 mandatory lessons, one self-directed. Programs have no mandatory order. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/chr1460978659140.html
- **2 Seek:** Skip Restrictions blocks forward skipping but allows review; Limit Question Attempts turns it on automatically. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/workday-drive-and-media-cloud.html
- **3 Grading:** Provide Course Grade applies to a video with multiple-choice interactions and a Passing Score, or to packaged content; one such lesson per mixed course. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/chr1460978659140.html
- **3 Quizzes:** Otherwise from third-party SCORM or AICC, whose logic sets status. External links complete on access. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/workday-learning-components.html
- **3 Other:** Mandatory flag per lesson; Disable View Course Again; Retake Course separate. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/chr1460978659140.html
- **4 Campaigns:** Required campaigns need a required audience; built from custom report, saved search, organisation, or Succession or Talent Pool. Default exclusion rule "Enable dynamic removal and resend" removes non-qualifiers and sends to new members. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/administer-learning.html
- **4 Mass enrol:** Can bypass prerequisites and capacity; Enroll My Team follows them and routes approvals. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/administer-learning.html
- **4 Due dates:** Duration or calendar date; reminders are mandatory when a due date exists (up to 3). Mass Reset Learning Due Dates extends them. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/administer-learning.html
- **4 Recurring:** Expiry by date, duration or recurrence frequency, on the last completed enrolment; retrain window; no reminders after expiry. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/learning-content-rules.html
- **5 Catalogue:** Single catalog with segmented security; Exclude from Search and Browse; Requires Enrollment. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/chr1460978659140.html
- **6 Roles:** Learning Administrator (user-based), Security Administrator, Manager (role-based), Learning Trainer; all driven by security domains. [snippet] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/define-workday-learning-business-processes-and-sec.html
- **6 Separation:** Domains split content (Manage: Learning Content), mass enrolment (Manage: Mass Enrollments), facilitated enrolment, and campaigns. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/administer-learning.html
- **6 Review workflow:** Not found, though enrolment runs on configurable business processes.
- **7 Versioning:** Split by type. Digital courses take edits immediately, with no effective date. Blended courses advance versions; existing offerings do not auto-update. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/maintain-learning-content-and-course-offerings.html
- **7 In-flight:** Update Offering to Version moves enrolled learners; a learner partway through a media lesson may restart that file. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/maintain-learning-content-and-course-offerings.html
- **8 Preboarding:** Pre-hires get Learning only after a confirmed start date. One catalog plus segmented security limits what they see; Required for You on the Onboarding dashboard shows mandatory items. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-setup-and-maintenance/learning-security/wnl1575369968713.html
- **8 Conversion:** Update security groups to employee groups; enable dynamic removal and resend so campaign content stays required. [fetched] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-setup-and-maintenance/learning-security/wnl1575369968713.html
- **8 External:** Extended Enterprise Learning needs a subscription; affiliations control access. [snippet] https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/extended-enterprise-learning/rjb1547753669105.html
- **9 Reports:** Find Learning Assignments, Find Learning Enrollments, Learning Campaign, Campaign Status by Category, My Team's Learning. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/administer-learning.html
- **10 Certificates:** Certification rules apply per course or program; must complete within the effective range; rescinding removes the achievement. Templates not found. [fetched] https://doc.workday.com/workday-education/en-us/course-manuals/learning-for-administrators/learning-content-rules.html
- **11 Mobile:** Workday Mobile app supports browse, enrol, complete, transcript, and team enrolment. Offline is not stated. [fetched] https://doc.workday.com/admin-guide/en-us/manage-workday/tenant-configuration/mobile-setup/tasks-in-workday-mobile/reference--learning-tasks-in-workday-mobile.html

---

## Indian HRMS suites

### Keka (Keka Learn)
- Native module inside the HR portal; courses use documents, text, video and quizzes. [snippet] https://help.keka.com/hc/en-us/articles/39946668558225-Keka-Learn-Overview
- Admins and managers assign to chosen employees or the whole organisation; each profile has a Learn tab. Setup involves a Learning Manager role. [snippet] https://help.keka.com/hc/en-us/articles/39946664256529-Getting-started-with-Keka-Learn
- Quizzes: single and multi select, passing score, limited tries. [snippet] https://help.keka.com/admin/creating-a-new-course
- Marketing claims auto-assign by role and location with reminders; help docs do not confirm it. [snippet] https://www.keka.com/learning-management-system
- Preboarding candidates use a separate limited portal for tasks; no evidence that Keka Learn reaches them. [snippet] https://help.keka.com/admin/managing-the-candidate-experience-portal-on-keka

### Darwinbox
- A marketplace listing names "Darwinbox LMS (Powered by Docebo)". [snippet] https://marketplace.darwinbox.com/en-US/apps/417537/darwinbox-lms-(powered-by-docebo)
- A second listing syncs course masters, enrolments and completions with Cornerstone. [snippet] https://marketplace.darwinbox.com/en-US/apps/443320/cornerstone
- Its blog describes an LMS inside the HCM with catalogs, learning paths and mobile-first learning; marketing only, and it sits awkwardly with the Docebo listing. [snippet] https://darwinbox.com/blog/10-best-learning-management-systems-lms-enterprise-hr

### greytHR
- No native LMS found. VioletLMS opens by SSO in a new tab from the Unite Marketplace. [fetched] https://www.greythr.com/help-ess-web/integrations-greythr-ess-web/violetlms-greythr-ess-unite-marketplace
- greytHR calls this a "first step" towards course assignments, completion tracking and data sync; no dates given. [fetched] https://www.greythr.com/help-ess-web/integrations-greythr-ess-web/violetlms-greythr-ess-unite-marketplace

### Zoho People LMS
- The deepest of the four. Roles: Employees, Managers (suggest, enrol reportees, grade), Administrators. [fetched] https://help.zoho.com/portal/en/kb/people/administrator-guide/learning-management-system-lms/overview/articles/lms-service-overview
- Access by rule: role, location, department, designation, user, group, experience. AND within a rule, OR across rules. Or restrict to Learning Plans only, which hides the course from the catalog. [fetched] https://help.zoho.com/portal/en/kb/people/administrator-guide/learning-management-system-lms/course-settings/articles/lms-course-settings
- Learning plans have levels, at least one mandatory course, unlock-after-course locks, and template-based certificates. [fetched] https://help.zoho.com/portal/en/kb/people/administrator-guide/learning-management-system-lms/courses-in-lms/articles/learning-plan
- Self-paced and blended modes. [snippet] https://www.zoho.com/people/learning-management-system.html
- Pre- and post-learning tests can count to the grade, which makes them mandatory. [fetched] https://help.zoho.com/portal/en/kb/people/administrator-guide/learning-management-system-lms/course-settings/articles/lms-course-settings
- Onboarding flows can tag self-paced courses new joiners must complete. [snippet] https://help.zoho.com/portal/en/kb/people/administrator-guide/onboarding-service/articles/onboarding-flows-zoho-people

---

## Comparison matrix

Key: ✓ verified. ✗ stated absent, or not in a documented option list. ? unverified. † inferred. "partial" and "plugin" as worded.
"?" does not mean absent. WP = Moodle Workplace only.

| Feature | TalentLMS | Moodle | Docebo | SAP SF | Cornerstone | Absorb | 360Learning | LearnUpon | Adobe LM | Workday |
|---|---|---|---|---|---|---|---|---|---|---|
| Quiz as sibling lesson after video | ✓ | ✓ | ✓† | ? | ✓† | ✓ | ✓ | ✓† | ✓† | ✓ |
| Quiz inside the video timeline | ✗† | ? | ? | ? | ? | ? | ? | ? | ? | ✓ |
| Lesson sequence locking | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Configurable video % rule | ✗† | plugin | ✗† fixed | ? | ✗ | ✗† end only | ? | ✓ | ✓ | ? |
| Seek blocking | ? | ? | ? | ? | ? | ✓ | ? | ? | ? | ✓ |
| Question bank or pool | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ reuse | ✓ | ? | ? |
| Randomised questions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ? | ? |
| Attempt limit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Time limit on quiz | ✓ | ✓ | ? | ? | ✓ | ? | ? | ? | ✓ | ? |
| Learning path entity | ✓ | WP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recurring or recertification | ✓ | WP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Dynamic rule for future members | partial | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Auto-unenrol on losing match | ? | ✓ | ? | ? | ✓ | ? | ✓ | ✓ | ✓ | ✓ |
| Relative due dates | ✓ | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Soft due date plus hard expiry | ? | ✓ quiz | ✓ | ? | ? | ✓ | ? | ✓ | ? | ? |
| Catalogue audience restriction | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Enrolment approval | ✓ | ? | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ✓ |
| Author separate from assigner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓† | ✓ | ✓ | ✓ | ✓ |
| Content review step | ? | ? | ? | ? | ? | ? | ✓ | ? | ? | ? |
| Explicit course versions | ✗† | ✗† | partial | ✓ | ✓ | ✗ label | ✓ | ✓ | ✓ | partial |
| Admin picks in-flight handling | partial | ✗† | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | partial |
| External or pre-joiner access | ✓ | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓† | ✓ | ✓ |
| Documented pre-joiner conversion | ? | ? | ? | ? | ? | partial† | ? | ? | ? | ✓ |
| Manager team view | ? | ? | ✓ | ✓ | ✓ | ? | ✓ | ✓ | ✓ | ✓ |
| Overdue tracking or report | ✗† | partial | ✓ | ? | ✓ | ✓ column | ✓ late flag | ? | ✓ | ✓† |
| Certificate templates | ✓ | plugin | ✓ | ? | ? | ✓ | ✓ | ✓ | ✓ | ? |
| Certificate expiry | ✓ | plugin | ✓ | ? | ✓ cert periods | ✓ | ✓ | ✓ | ✓ | ✓ |
| Public certificate verification | partial URL | plugin | ? | ? | ? | ? | ? | ? | ? | ? |
| Native mobile app | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Offline learning | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | partial | ? |

---

## Common patterns across products

Strength reflects how many products showed the pattern with evidence.

### Very strong (8+ products)

1. **Native mobile and sequencing are table stakes.** All 10 ship a native app and all 10 can lock lesson order.
2. **Assignment is a rule, not a list.** Nine of ten offer a rule that catches future members; TalentLMS needs an
   opt-in setting. The one-off bulk enrol is a separate operation: Moodle (manual versus cohort sync), Cornerstone
   (standard versus dynamic), SAP (free-floating versus assignment profile), Adobe (enrol versus Learning Plan).
3. **Rules are usually forward-only, so "existing members" needs its own decision.** Docebo rules skip pre-existing
   members and later-added content. TalentLMS does the same. Adobe exposes it as an explicit option on the trigger.
   Absorb goes the other way and re-evaluates on publish and profile change.
4. **Author, assigner and reporter are separate powers, and scope is separate from role.** Docebo (profile plus
   resources), Absorb (role plus All/Group/Department), Cornerstone (permission plus OU), 360Learning (per-group
   roles), Adobe (scoped custom roles), Workday (domains). Cornerstone even splits upload from publish.
5. **Nobody needs an instructor for self-paced delivery.** [inferred] Where the role exists, it covers ILT, marking
   or course-level reporting: LearnUpon instructors do not create by default, Adobe instructors run sessions, Docebo
   instructors evaluate assignments, and Workday digital courses exclude instructor lessons.
6. **Quiz is a sibling lesson, not a property of a video.** Workday is the only one verified with quizzes on the video
   timeline. TalentLMS has an inline question but tells customers to use a real test, because the answer is not reported.
7. **A named bundle above the course exists everywhere,** with core Moodle as the exception (Workplace only). It
   carries the recertification or retraining logic in SAP (curricula only), Docebo (certifications as learning plans)
   and Adobe.
8. **Relative due dates are the default; calendar dates serve annual compliance.** LearnUpon says so outright.
   Group-level due dates apply prospectively in LearnUpon. Cornerstone recommends relative for daily processing.

### Strong (5-7 products)

9. **Recurrence hangs off a certificate or completion date, not a calendar job.** Typical form: re-enrol N days before
   expiry or N months after completion (Absorb, LearnUpon, 360Learning, TalentLMS, Adobe, Workday).
10. **Repeat completions are kept as history.** Absorb marks old enrolments historic, Docebo archives, TalentLMS keeps
    the last 20 certificates, Workday applies expiry to the last completed enrolment. Rewriting the old row is not the norm.
11. **Mature versioning decides per learner status.** The shape is Not Started / In Progress / Completed: Adobe (three
    named options), LearnUpon (publish dialog), Cornerstone (status selections), Docebo (overwrite versus version).
    Completers keep their record in nearly all; in-progress learners either restart or finish the old version.
12. **Moving an in-progress learner means restarting.** LearnUpon, Absorb and Docebo restart them; Adobe resets the
    module; Workday may restart the media file. 360Learning instead leaves them on the old version until the next attempt.
13. **Quiz tools converge on the same settings:** pass percent, attempt cap with 0 or blank meaning unlimited, best or
    latest score, shuffle, a pool with a draw count, optional timer, optional show-answers. Defaults vary (Cornerstone
    80%, TalentLMS 50%).
14. **Catalogue and assignment are independent.** Cornerstone says training with no availability can still be assigned.
    Docebo requires both internal-catalog display and self-enrolment. Zoho's "through Learning Plan" hides from the catalog.
15. **Approval is per course and optional,** with supervisor or manager as a common approver (Absorb, LearnUpon, Adobe,
    SAP, Cornerstone, Workday). Rule-based and admin enrolment bypass it in Absorb and Workday mass enrol.
16. **Manager views follow the reporting line, not a manual list.** Cornerstone auto-assigns the Manager role; Workday
    has a Manager group; Docebo My team is direct reports.
17. **Overdue is shown as buckets with a warning window.** Adobe: non-compliant, under 30 days, over 30 days, compliant.
    Docebo: overdue or due in 14 days. 360Learning: expiring within 30 days. Cornerstone adds past-due aging.
18. **Offline covers uploaded files, not hosted links.** YouTube, Vimeo and URL video are excluded (TalentLMS, Docebo,
    Absorb). Tests are often excluded too: Docebo has no offline tests, and 360Learning computes no scores on device.
    Absorb is the exception, with offline assessments.

### Moderate (fewer products, or weaker evidence)

19. **Video completion is weak, and vendors say so.** Three models: fixed threshold (Docebo 90% or 15 seconds, Cornerstone
    100%, Absorb end of video), configurable percent (LearnUpon, Adobe), or time or button (TalentLMS). Only Absorb and
    Workday verifiably block seeking, and Absorb warns that it cannot be fully enforced in HTML5.
20. **Publish state is common; a review gate is rare.** Only 360Learning has a documented review step. Treat this as
    "not found" rather than proven absent. Draft and publish alone is the observed norm.
21. **Pre-joiner access takes two shapes.** HR suites use the same identity with a future start date: Workday needs a
    confirmed start date, and SAP syncs Onboarding hires to Learning. Standalone LMSs treat them as an external audience
    in a partition: TalentLMS branch, Docebo branch and domain, Absorb department, Adobe external profile, 360Learning
    self-registration. Only Workday documents the hand-over to employee. In Absorb, a department change is the likely route.
22. **Rule engines surprise admins.** Absorb re-enrols manually removed learners; Docebo group recalculation re-triggers
    rules; SAP double-assigns via two profiles; Cornerstone only reassigns after dynamic removal. Audit logs and rollback
    matter (Docebo Logs tab, SAP audit report).
23. **Certificate verification is the weakest area.** Only TalentLMS (public download URL) and Moodle plugins (code, link,
    QR) surfaced anything. Templates with dynamic fields are common; authenticity checks are not.
24. **Indian suites are far shallower than global LMSs.** Zoho People is the closest, with attribute rules, plans and
    certificates. Keka Learn covers the basics. greytHR only offers SSO to VioletLMS. Darwinbox leans on Docebo and
    Cornerstone listings, while its marketing describes a native LMS. No Indian suite was found to offer verified
    course versioning, recertification or preboarding learning.
