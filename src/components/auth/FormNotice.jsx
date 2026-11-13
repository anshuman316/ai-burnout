import React from 'react'

// Problems are shown in a soft yellow note, never red (CLAUDE.md design rules).
// tone="info" is for good news, like "Check your email".
const FormNotice = ({ id, tone = 'problem', children }) => (
    <p
        id={id}
        role={tone === 'problem' ? 'alert' : 'status'}
        className={`flex items-start gap-2 p-3 rounded-xl text-[14px] text-heading ${tone === 'problem' ? 'bg-sun/15' : 'bg-mint'}`}
    >
        <span className="material-symbols-outlined text-[18px] mt-px" aria-hidden="true">{tone === 'problem' ? 'info' : 'mark_email_read'}</span>
        <span>{children}</span>
    </p>
)

export default FormNotice
