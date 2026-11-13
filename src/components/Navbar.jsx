import React, { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const links = [
    { to: '/home', label: 'Home', icon: 'home' },
    { to: '/diary', label: 'Diary', icon: 'book' },
    { to: '/goals', label: 'Goals', icon: 'adjust' },
    { to: '/chat', label: 'Chat', icon: 'chat_bubble' }
]

// Profile button: "Log in" when signed out, a small menu with "Log out" when signed in
const AccountMenu = () => {

    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    const { session } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!open) return;
        const handleOutside = (e) => {
            if (!menuRef.current?.contains(e.target)) setOpen(false);
        }
        const handleEscape = (e) => {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    const handleLogOut = async () => {
        setOpen(false);
        const { error } = await supabase.auth.signOut();
        if (error) console.error('Log out failed:', error.message);
        navigate('/');
    }

    const avatarClass = 'w-9 h-9 rounded-full bg-forest text-white flex items-center justify-center hover:bg-forest/90 transition-colors';

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-controls="account-menu"
                aria-label="Your account"
                className={avatarClass}
            >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">person</span>
            </button>
            {open && (
                <div id="account-menu" className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-white border border-hairline p-2 z-40">
                    <p className="px-3 py-2 text-[13px] text-body truncate">{session.user.email}</p>
                    <button type="button" onClick={handleLogOut} className="w-full text-left px-3 py-2 rounded-xl text-[14px] font-medium text-heading hover:bg-mint transition-colors">
                        Log out
                    </button>
                </div>
            )}
        </div>
    )
}

const Navbar = () => {

    const { session, profileStatus } = useAuth();
    // App tabs appear once someone is signed in and has finished onboarding
    const appReady = Boolean(session) && profileStatus === 'complete';

    const topLinkClass = ({ isActive }) =>
        `px-4 py-1.5 rounded-full text-[14px] transition-colors ${isActive ? 'bg-mint text-forest font-semibold' : 'text-body hover:text-heading'}`;

    const tabClass = ({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 text-[12px] ${isActive ? 'text-forest font-semibold' : 'text-body'}`;

    return (
        <>
            <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-hairline">
                <div className="max-w-6xl mx-auto h-16 px-4 md:px-8 flex items-center justify-between">
                    <Link to={appReady ? '/home' : '/'} className="flex items-center gap-2.5 font-headline text-[18px] font-bold tracking-tight text-heading">
                        <img src="/logo.png" alt="" className="w-9 h-9" />
                        Equilibria
                    </Link>
                    <div className="flex items-center gap-4">
                        {appReady && (
                            <>
                                <nav aria-label="Main" className="hidden md:block">
                                    <ul className="flex items-center gap-1">
                                        {links.map((link) => (
                                            <li key={link.to}>
                                                <NavLink to={link.to} className={topLinkClass}>{link.label}</NavLink>
                                            </li>
                                        ))}
                                    </ul>
                                </nav>
                                <span className="hidden md:block h-5 w-px bg-hairline" aria-hidden="true" />
                            </>
                        )}
                        {session ? <AccountMenu /> : (
                            <div className="flex items-center gap-2">
                                <NavLink to="/login" className={topLinkClass}>Log in</NavLink>
                                <Link to="/signup" className="h-9 px-4 rounded-full border border-forest text-forest text-[14px] font-medium flex items-center hover:bg-mint transition-colors">Get started</Link>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Phones: tabs along the bottom */}
            {appReady && <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-hairline pb-[env(safe-area-inset-bottom)]">
                <ul className="grid grid-cols-4">
                    {links.map((link) => (
                        <li key={link.to}>
                            <NavLink to={link.to} className={tabClass}>
                                {({ isActive }) => (
                                    <>
                                        <span className={`px-4 py-0.5 rounded-full ${isActive ? 'bg-mint' : ''}`} aria-hidden="true">
                                            <span className="material-symbols-outlined text-[22px]">{link.icon}</span>
                                        </span>
                                        {link.label}
                                    </>
                                )}
                            </NavLink>
                        </li>
                    ))}
                </ul>
            </nav>}
        </>
    )
}

export default Navbar
