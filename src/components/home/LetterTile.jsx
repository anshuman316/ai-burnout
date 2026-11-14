import React, { useState } from 'react'
import { formatMonthDay } from '../../lib/dates'
import { LaterNote, Tile, TileHeader } from './Tile'

const LetterTile = ({ letter, className, style }) => {

    const [laterNote, setLaterNote] = useState('');
    const sealedLabel = `${letter.sealedCount} letter${letter.sealedCount === 1 ? '' : 's'} sealed · Opens ${formatMonthDay(letter.opensOn)}`;

    return (
        <Tile labelledBy="letter-heading" className={className} style={style}>
            <TileHeader id="letter-heading" icon="mark_email_read" title="Letter to future you" />

            <div className="mt-5 flex flex-col items-center gap-3">
                {/* Sealed envelope with a sun-yellow seal */}
                <svg className="w-36 h-24" viewBox="0 0 144 96" fill="none" aria-hidden="true">
                    <rect x="1" y="1" width="142" height="94" rx="8" fill="var(--color-mint)" stroke="var(--color-hairline)" />
                    <path d="M2 4 L72 50 L142 4" stroke="var(--color-forest)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 94 L52 48" stroke="var(--color-forest)" strokeOpacity="0.3" strokeWidth="1.25" strokeLinecap="round" />
                    <path d="M142 94 L92 48" stroke="var(--color-forest)" strokeOpacity="0.3" strokeWidth="1.25" strokeLinecap="round" />
                    <circle cx="72" cy="50" r="11" fill="var(--color-sun)" />
                    <path d="M67 52c3-6 8-7 10-7-1 4-3 8-10 7Z" fill="var(--color-forest)" />
                </svg>
                <p className="text-[15px] font-medium text-heading">{sealedLabel}</p>
            </div>

            <div className="mt-3 mb-4 min-h-5 text-center"><LaterNote>{laterNote}</LaterNote></div>
            <div className="mt-auto pt-4 border-t border-hairline flex items-center justify-between gap-3">
                <button type="button" onClick={() => setLaterNote('Writing letters comes in a later version.')} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-forest hover:underline">
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">edit_calendar</span>
                    Write another
                </button>
                <span className="text-[13px] text-body">Sealed until then</span>
            </div>
        </Tile>
    )
}

export default LetterTile
