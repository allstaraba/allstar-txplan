import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

const SECTIONS = [
  { id: 'client_info', title: 'Client Information', fields: [
    { key: 'client_full_name', label: 'Client Full Name', required: true },
    { key: 'date_of_birth', label: 'Date of Birth', required: true },
    { key: 'date_of_assessment', label: 'Date of Assessment', required: true },
    { key: 'date_of_reassessment', label: 'Date of Reassessment' },
  ]},
  { id: 'family', title: 'Family Structure', fields: [
    { key: 'parent_guardian_name', label: 'Parent/Guardian Name', required: true },
    { key: 'parent_guardian_phone', label: 'Parent/Guardian Phone' },
    { key: 'parent_guardian_email', label: 'Parent/Guardian Email' },
    { key: 'father_caregiver_name', label: 'Father/Caregiver Name' },
    { key: 'siblings', label: 'Siblings (names & ages)' },
    { key: 'marital_status', label: 'Marital Status' },
    { key: 'individuals_living_in_home', label: 'Individuals Living in Home', type: 'textarea' },
    { key: 'cultural_legal_issues', label: 'Cultural/Legal Issues', type: 'textarea' },
    { key: 'environmental_factors', label: 'Environmental Factors', type: 'textarea' },
    { key: 'safety_concerns', label: 'Safety Concerns (aggression/SIB/elopement)', type: 'textarea' },
  ]},
  { id: 'medications', title: 'Medications', fields: [
    { key: 'medications', label: 'Medications (name / dosage / frequency / prescriber)', type: 'textarea' },
  ]},
  { id: 'medical', title: 'Medical History', fields: [
    { key: 'pcp_name', label: 'PCP Name' },
    { key: 'pcp_phone', label: 'PCP Phone' },
    { key: 'allergies', label: 'Allergies' },
    { key: 'medical_concerns', label: 'Medical Concerns', type: 'textarea' },
    { key: 'dietary_restrictions', label: 'Dietary Restrictions' },
    { key: 'surgery_history', label: 'Surgery History', type: 'textarea' },
    { key: 'er_history', label: 'ER / Hospitalization History', type: 'textarea' },
    { key: 'family_mental_health_history', label: 'Family Mental Health History', type: 'textarea' },
  ]},
  { id: 'birth', title: 'Birth History', fields: [
    { key: 'pregnancy_complications', label: 'Pregnancy Complications', type: 'textarea' },
    { key: 'birth_concerns', label: 'Birth / Neonatal Concerns', type: 'textarea' },
    { key: 'delivery_method', label: 'Delivery Method (vaginal / cesarean)' },
    { key: 'weeks_gestation', label: 'Weeks Gestation' },
  ]},
  { id: 'school', title: 'School Placement', fields: [
    { key: 'school_name', label: 'School Name' },
    { key: 'school_setting', label: 'School Setting (general ed, self-contained, etc.)' },
    { key: 'grade', label: 'Grade' },
    { key: 'school_schedule', label: 'School Schedule', type: 'textarea' },
    { key: 'school_hours_per_week', label: 'School Hours Per Week' },
  ]},
  { id: 'aba', title: 'ABA History', fields: [
    { key: 'prior_aba_history', label: 'Prior ABA History (provider / dates / hours / reason discontinued)', type: 'textarea' },
  ]},
  { id: 'other_services', title: 'Other Services', fields: [
    { key: 'other_mental_health_services', label: 'Other Mental Health Services', type: 'textarea' },
    { key: 'other_services_slp_ot', label: 'Other Services (SLP, OT, etc.)', type: 'textarea' },
  ]},
  { id: 'coordination', title: 'Coordination of Care', fields: [
    { key: 'coordination_providers', label: 'Coordination Providers (name / role / phone)', type: 'textarea' },
    { key: 'major_life_changes', label: 'Major Life Changes', type: 'textarea' },
  ]},
  { id: 'observation', title: 'Observation Details', fields: [
    { key: 'observation_date', label: 'Observation Date' },
    { key: 'observation_start_time', label: 'Start Time' },
    { key: 'observation_end_time', label: 'End Time' },
    { key: 'observation_location', label: 'Observation Location' },
    { key: 'individuals_present', label: 'Individuals Present', type: 'textarea' },
  ]},
  { id: 'hours', title: 'Recommended Hours', fields: [
    { key: 'hours_97153', label: '97153 — Direct BT Hours/Week', required: true },
    { key: 'hours_97155', label: '97155-GT — BCBA Hours/Week', required: true },
    { key: 'hours_97156', label: '97156-GT — Parent Training Hours/Week' },
    { key: 'hours_97151', label: '97151 — Assessment Hours (total)' },
    { key: 'authorization_start_date', label: 'Authorization Start Date' },
    { key: 'authorization_end_date', label: 'Authorization End Date' },
    { key: 'service_location', label: 'Service Location (Home / Clinic / School)' },
  ]},
  { id: 'provider', title: 'Provider Information', fields: [
    { key: 'supervising_bcba_name', label: 'Supervising BCBA Name', required: true },
    { key: 'supervising_bcba_credentials', label: 'BCBA Credentials' },
    { key: 'supervising_bcba_phone', label: 'BCBA Phone' },
  ]},
  { id: 'emergency', title: 'Emergency Contacts', fields: [
    { key: 'emergency_contact_name', label: 'Emergency Contact Name' },
    { key: 'emergency_contact_phone', label: 'Emergency Contact Phone' },
  ]},
];

export default function ClientInfoReview({ pendingReview, onStartGeneration }) {
  const initFormData = useCallback(() => {
    if (!pendingReview) return {};
    const data = {};
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        const found = pendingReview.found[field.key];
        data[field.key] = (found !== null && found !== undefined) ? String(found) : '';
      }
    }
    return data;
  }, [pendingReview]);

  const [formData, setFormData] = useState(initFormData);
  const [attempted, setAttempted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!pendingReview) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#64748b', fontSize: '16px', marginBottom: '16px' }}>No review pending.</p>
        <Link to="/generate" style={{ color: '#2563eb', fontSize: '14px' }}>Back to Generate Plan</Link>
      </div>
    );
  }

  const allRequiredFields = SECTIONS.flatMap(s => s.fields.filter(f => f.required));
  const missingRequired = allRequiredFields.filter(f => !formData[f.key] || !formData[f.key].trim());
  const missingCount = missingRequired.length;

  const isMissing = (key) => pendingReview.found[key] === null || pendingReview.found[key] === undefined;

  const getInputStyle = (field) => {
    const base = {
      width: '100%',
      padding: '8px 10px',
      border: '1.5px solid #e2e8f0',
      borderRadius: '6px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
      background: '#fff',
      outline: 'none',
      resize: 'vertical',
    };
    const missing = isMissing(field.key);
    const requiredEmpty = field.required && attempted && (!formData[field.key] || !formData[field.key].trim());

    if (requiredEmpty) {
      return { ...base, borderColor: '#ef4444', background: '#fff5f5' };
    }
    if (missing) {
      return { ...base, background: '#fefce8', borderColor: '#fde047' };
    }
    return base;
  };

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    setAttempted(true);
    if (missingCount > 0) {
      setSubmitError('Please fill in all required fields (highlighted in red).');
      return;
    }
    setSubmitError('');
    setGenerating(true);
    onStartGeneration(pendingReview.notes, formData);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Fixed top bar */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            Complete Client Information
          </h1>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0' }}>
            Fields highlighted in yellow were not found in the uploaded notes — please fill them in.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#64748b' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', background: '#fefce8', border: '1.5px solid #fde047', borderRadius: '3px' }} />
              Not found in notes
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '14px', height: '14px', background: '#fff5f5', border: '1.5px solid #ef4444', borderRadius: '3px' }} />
              Required — must fill in
            </span>
          </div>

          {missingCount > 0 && (
            <span style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '20px',
              padding: '4px 12px',
              fontSize: '13px',
              fontWeight: '600',
              color: '#dc2626',
            }}>
              {missingCount} required field{missingCount !== 1 ? 's' : ''} missing
            </span>
          )}

          <button
            onClick={handleSubmit}
            disabled={generating}
            style={{
              padding: '10px 24px',
              background: generating ? '#93c5fd' : '#2563eb',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              cursor: generating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            {generating ? (
              <>
                <span style={{
                  display: 'inline-block', width: '14px', height: '14px',
                  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                }} />
                Starting generation…
              </>
            ) : 'Looks Good — Generate Plan'}
          </button>
        </div>
      </div>

      {submitError && (
        <div style={{
          margin: '16px 32px 0',
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#dc2626',
          fontSize: '14px',
        }}>
          {submitError}
        </div>
      )}

      {/* Main content */}
      <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '20px',
        }}>
          {SECTIONS.map(section => (
            <div key={section.id} style={{
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '20px',
            }}>
              <h2 style={{
                fontSize: '14px',
                fontWeight: '700',
                color: '#0f172a',
                margin: '0 0 16px',
                paddingBottom: '8px',
                borderBottom: '1px solid #f1f5f9',
              }}>
                {section.title}
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
              }}>
                {section.fields.map(field => {
                  const isTextarea = field.type === 'textarea';
                  return (
                    <div
                      key={field.key}
                      style={{ gridColumn: isTextarea ? '1 / -1' : 'auto' }}
                    >
                      <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#374151',
                        marginBottom: '4px',
                      }}>
                        {field.label}
                        {field.required && (
                          <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>
                        )}
                      </label>
                      {isTextarea ? (
                        <textarea
                          rows={3}
                          value={formData[field.key] || ''}
                          onChange={e => handleChange(field.key, e.target.value)}
                          style={getInputStyle(field)}
                          onFocus={e => {
                            e.target.style.borderColor = '#2563eb';
                            e.target.style.outline = 'none';
                          }}
                          onBlur={e => {
                            const s = getInputStyle(field);
                            e.target.style.borderColor = s.borderColor;
                          }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={formData[field.key] || ''}
                          onChange={e => handleChange(field.key, e.target.value)}
                          style={getInputStyle(field)}
                          onFocus={e => {
                            e.target.style.borderColor = '#2563eb';
                            e.target.style.outline = 'none';
                          }}
                          onBlur={e => {
                            const s = getInputStyle(field);
                            e.target.style.borderColor = s.borderColor;
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
