// plan-boilerplate.js
// Verbatim boilerplate text injected AFTER generation — never sent to the API.
// The AI writes placeholder markers; this module replaces them post-generation.

const DEESCALATION = `- Stay calm to prevent the situation from escalating. Ensure the area is clear of environmental hazards.
- Provide praise and acknowledgment for every 5s of continuous calm to reinforce de-escalation.
- Stay low and loose, and pay attention to the client by telling them you are there to help.
- Follow their lead.
- Validate and empathize. Allow non-judgmental time (provide space and calm down time as needed). Do not overwhelm the client with words or requests.
- Use a calm voice and model coping techniques without placing demands to do so. (e.g., deep breaths, counting to 10, drinking water)
- Offer choices of available items and activities when he/she shows that he/she is ready.`;

const GENERALIZATION_STEPS = `1. ABA treatment will begin in the instructional setting (e.g., at a table/desk which remains in the same location, in a location with minimum distractions) in order to reduce distractions during the initial training phase.
2. Generalization training is first introduced in the instructional setting with the goal of promoting generalization as soon as possible during the course of treatment and with the least intrusive, most efficient strategies possible. Generalization across instructors is built into treatment sessions which are typically taught by two instructors. Programs are taught using natural language and with three sets of instructions in the instructional setting.
3. Should generalization training during the initial training phase result in overgeneralization or faulty stimulus control, one or more forms of generalized behavior change may need to be taught in isolation of one another.
4. Once a student has learned items presented in the instructional setting, additional training occurs in the generalization setting. The generalization setting consists of other locations within the treatment setting. Programs are completed out of the chair and in various rooms which are increasingly more and more distracting. Programs are completed using various materials — photos, objects, videos, and books. Response variability is reinforced to promote response generalization.
5. Programs are taught to caregivers (e.g., parents, other family members, nannies, etc.) in the treatment setting.
6. Programs are practiced with caregivers in community settings to the extent necessary to ensure generalization of skills to the natural setting.`;

const MAINTENANCE_STEPS = `1. Programs are placed on a maintenance schedule: Daily for minimum 1 week; Weekly for minimum 1 month; Semi-monthly for minimum 1 month; Monthly for minimum 1 month; Bi-monthly for minimum 3 months; Semi-annually for minimum 6 months.
2. When conducting maintenance probes, all targets within a program should be assessed if possible. For programs with many targets (e.g., 25 targets), the instructor will assess no less than 20% of total targets. For programs with fewer targets (e.g., 5 targets), no less than 3 targets will be assessed.
3. The student must respond independently on 2/3 of maintenance probes for the program to be eligible for promotion to the next scheduled maintenance assessment.
4. If the student does not meet criterion for promotion, the team will determine if the program or specific target needs to be re-taught and then added back to the maintenance schedule.`;

const DATA_COLLECTION_TEMPLATE = `%%CLIENT%% direct interventionists will be trained in the implementation of this plan and data collection systems, and this plan will be monitored in accordance with the practice act. Data collection will occur on skill acquisition and behavior reduction targets during all treatment sessions. %%CLIENT%% ABA providers and parents will collect ABC data on novel maladaptive behaviors, maladaptive behaviors that occur with no clear antecedent, or should maladaptive behaviors increase in intensity, frequency, or duration. During sessions, data will be documented immediately as events occur using Central Reach. Revisions to this plan may occur based on an ongoing analysis of the data.`;

const DISCHARGE_CRITERIA = `Discharge will be considered when:
- The legal guardian no longer requests services.
- Upon mastery of all age-appropriate objectives.
- When your child has mastered all skills required to function independently in the home/community setting.
- When the diagnosing physician determines that your child no longer meets the diagnostic criteria for ASD.
- If your child does not demonstrate progress towards treatment goals for successive authorization periods.
- If your insurance company denies authorization for continued services and you do not wish to establish another payment model for services.
- If you do not comply with our policies, requirements, or responsibilities.
- If you fail to comply with the treatment plan, recommendations for service hours, or participate in family training.
- If payment for services is not obtained.
- If we are not able to reconcile important issues in treatment planning and service delivery.

Discharge planning will be a part of regular treatment planning that occurs throughout the course of treatment and will involve all members of the treatment team. Upon discharge, a report including recommendations for continuity of care will be provided.
Anticipated Discharge Date from All Star ABA: To be determined

How the Family Can Contact the Provider After Discharge:
Following discharge, the family may contact All Star ABA with any questions or concerns at any time. Phone: 410-541-1316. Office: 1777 Reisterstown Road, Pikesville, MD 21208. A discharge summary report with recommendations for continuity of care will be provided to the family at the time of discharge.

Community Resources Available to the Family:
- Autism Society of Maryland: autism-society.org/chapters/maryland | 410-655-7933
- The Arc of Maryland: thearcmd.org | advocacy and support for individuals with intellectual and developmental disabilities
- Maryland Developmental Disabilities Administration (DDA): dda.health.maryland.gov | community-based waiver services and supports
- Kennedy Krieger Institute Community Programs: kennedykrieger.org | specialized outpatient and community support services
- Maryland's Children's Behavioral Health: mbhp.com | behavioral health resources and care coordination
- Local recreational and social skills programs for individuals with ASD — contact your school district's Special Education office for referrals to community-based social skills groups and recreational programs`;

const POST_CRISIS = `- Contact clinical supervisor as soon as feasible.
- Submit a completed Incident Report within 24 hours.
- Conduct clinical review and follow-up supervision.
- Increase supervision frequency temporarily, if needed.
- Conduct a new Functional Behavior Assessment (FBA) if novel or escalating crisis behavior is observed.
- Update Behavior Intervention Plan (BIP) and crisis plan accordingly.`;

const FADING_INTRO = `All Star ABA wishes to support clients through any possible transitions that may occur during treatment (e.g., transition to summer programming, change of schools/grades/academic programming, change of address, family dynamic changes, etc.). Transition planning will be a part of regular treatment planning that occurs throughout the course of treatment and will involve all members of the treatment team.`;

const DIAGNOSIS_SECTION = `| Diagnosis | |
| ICD-10 Code: | [TO BE COMPLETED BY BCBA] |
| Date of Diagnosis: | [TO BE COMPLETED BY BCBA] |
| Diagnosing Professional — Name: | [TO BE COMPLETED BY BCBA] |
| Diagnosing Professional — Title: | [TO BE COMPLETED BY BCBA] |
| Diagnosing Professional — Credentials: | [TO BE COMPLETED BY BCBA] |`;

const COORDINATION_CARE = `Coordination of care will involve the deliberate organization of patient care activities between All Star ABA and other members involved in the patient's care to facilitate appropriate health care services. All Star ABA requested consent to coordinate care with all members of the care team, as indicated below. Written consent will be obtained prior to sharing information with other health care providers and all HIPAA regulations will be adhered to at all times.`;

const COORDINATION_NOTES = `Coordination will occur once per authorization period, likely prior to re-assessment. Coordination will include discussion of problem behavior and progress made, and the behavior plan. The need for more frequent coordination will be continuously assessed and provided as needed.`;

const MEDICAL_NECESSITY = `ABA (Applied behavior analysis) is a scientifically supported model of treatment to remediate the functional impairments typically found in people with Autism Spectrum Disorder (ASD). Treatment will focus on increasing client's communication skills, social skills, and reduce problem behavior, and should result in progressive, measurable gains in functioning on a standardized measure.`;

const ATTESTATION = `I hereby attest that I have individually reviewed the listed items and confirm they are true and correct.`;

const CONSENT = `I have read the goals and behavior intervention plan as outlined in this report. I have been provided with the opportunity to ask any questions, my questions have been answered, and with this knowledge, I voluntarily consent to this treatment plan.`;

function buildTelehealthChecklist(clientName, bcbaName, assessmentDate) {
  return `Maryland Medicaid Telehealth Readiness Checklist
Date Completed: ${assessmentDate}
Participant Name: ${clientName}
BCBA Name: ${bcbaName}

Personnel Education/Qualifications:
- Did each practitioner (BCBA/RBT/BT) attend training on technology related to telehealth? Yes
- Did each practitioner (BCBA/RBT/BT) attend training or obtain supervision related to telehealth-specific ABA interventions? Yes

Technology and Data Confidentiality:
- Do each of the practitioners have the necessary equipment to provide telehealth services per COMAR10.09.49? Yes
- Do the parents/caregivers have the necessary equipment to receive telehealth services? Yes
- Is there a process in place in the event technological issues arise during telehealth services? Yes
- Has the practitioner explained the risks related to use of technology for telehealth services? Yes

Implementation and Evaluation:
- Does the practitioner have monitoring tools in place to evaluate the implementation of telehealth services? Yes
- Does the practitioner have monitoring tools in place to evaluate the effectiveness of telehealth services? Yes

Environmental Evaluation:
- Is the participant's environment set up to accommodate telehealth services? Yes
- Is there a process in place to ensure the participant's environment remains telehealth ready? Yes
- Is the BCBA's environment safe to conduct telehealth services? Yes

Capabilities of Participant/Parent:
- Is the participant able to see the practitioner on the screen without displaying interfering behaviors? Yes
- Is the participant able to follow directions given by parents/caregivers without in-person supports? Yes
- Are the parents/caregivers able to follow technical instructions given by the practitioner? Yes

Standard of Care Considerations and Consent:
- Has the practitioner taken into account any cultural considerations when proposing telehealth services? Yes
- Is the parent/caregiver interested in telehealth services and signed consent for telehealth services? Yes
- Does the consent form include information related to the risks and benefits of telehealth services including confidentiality? Yes
- Does the consent form include the ability to opt out of telehealth services? Yes`;
}

/**
 * Replace all boilerplate markers in the generated plan text.
 * @param {string} text - The raw generated plan (may contain markers)
 * @param {string} clientName - The client's full name
 * @param {string} bcbaName - The supervising BCBA's name and credentials
 * @param {string} assessmentDate - The assessment date
 * @returns {string} - Plan text with all markers replaced
 */
function buildGoalSummaryTable(goalCount) {
  const n = goalCount || 0;
  return `| Total # of goals: | ${n} |
| Total # of goals mastered: | N/A |
| Total # of goals in-progress: | N/A |
| Total # of goals on hold: | N/A |
| Total # of goals discontinued: | N/A |
| Total # of new goals: | ${n} |`;
}

function injectBoilerplate(text, clientName = '', bcbaName = '[BCBA NAME]', assessmentDate = '[DATE]', goalCount = 0) {
  const clientPossessive = clientName ? `${clientName}'s` : "The client's";

  return text
    .replace(/\[GOAL_SUMMARY_TABLE\]/g, buildGoalSummaryTable(goalCount))
    .replace(/\[STANDARD_DEESCALATION_PROTOCOL\]/g, DEESCALATION)
    .replace(/\[STANDARD_GENERALIZATION_STEPS\]/g, GENERALIZATION_STEPS)
    .replace(/\[STANDARD_MAINTENANCE_STEPS\]/g, MAINTENANCE_STEPS)
    .replace(/\[DATA_COLLECTION_LANGUAGE\]/g,
      DATA_COLLECTION_TEMPLATE.replace(/%%CLIENT%%/g, clientPossessive))
    .replace(/\[DIAGNOSIS_SECTION\]/g, DIAGNOSIS_SECTION)
    .replace(/\[DISCHARGE_CRITERIA\]/g, DISCHARGE_CRITERIA)
    .replace(/\[POST_CRISIS_PROCEDURES\]/g, POST_CRISIS)
    .replace(/\[FADING_PLAN_INTRO\]/g, FADING_INTRO)
    .replace(/\[COORDINATION_CARE_LANGUAGE\]/g, COORDINATION_CARE)
    .replace(/\[COORDINATION_NOTES_LANGUAGE\]/g, COORDINATION_NOTES)
    .replace(/\[MEDICAL_NECESSITY_LANGUAGE\]/g, MEDICAL_NECESSITY)
    .replace(/\[ATTESTATION_LANGUAGE\]/g, ATTESTATION)
    .replace(/\[CONSENT_LANGUAGE\]/g, CONSENT)
    .replace(/\[TELEHEALTH_CHECKLIST\]/g, buildTelehealthChecklist(clientName, bcbaName, assessmentDate));
}

module.exports = { injectBoilerplate, buildGoalSummaryTable };
