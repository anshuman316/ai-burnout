import { useEffect, useState } from 'react'
import { applyTheme, currentTheme, readSavedTheme, saveTheme, systemTheme } from '../lib/theme'

// The sun/moon button in the navbar. Before anyone chooses, it follows the computer
// (and keeps following it if the computer switches to dark in the evening).
// Once someone taps the button, their choice is remembered and wins from then on.
export const useTheme = () => {

    const [theme, setTheme] = useState(currentTheme);

    // In case the small script in index.html didn't run (or ran before storage was ready)
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            if (readSavedTheme()) return; // They've picked a theme: leave it alone
            setTheme(systemTheme());
        }
        media.addEventListener('change', handleChange);
        return () => media.removeEventListener('change', handleChange);
    }, []);

    const toggle = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        saveTheme(next);
    }

    return { theme, toggle };
}
