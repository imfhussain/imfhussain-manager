// Studio money is hidden on screen until "Show" is tapped (Home, Events list, event page).
// One switch for the whole app; it is hidden again every time the app is opened.
import { rs } from './util.js';
let shown = false;
export const moneyShown = () => shown;
export const toggleMoney = () => { shown = !shown; return shown; };
export const hideRs = (v) => (shown ? rs(v) : 'Rs ••••');
