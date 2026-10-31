'use client';
import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { translate,type Locale } from '../lib/translations';

type Theme='dark'|'light';
type Preferences={locale:Locale;theme:Theme;setLocale:(locale:Locale)=>void;setTheme:(theme:Theme)=>void;t:(text:string)=>string};
const PreferencesContext=createContext<Preferences|null>(null);
const localeKey='narxpilot.locale';const themeKey='narxpilot.theme';
export function PreferencesProvider({children}:{children:ReactNode}) {
  const [locale,setLocale]=useState<Locale>('ru');const [theme,setTheme]=useState<Theme>('dark');const [loaded,setLoaded]=useState(false);
  useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;try{const savedLocale=localStorage.getItem(localeKey);const savedTheme=localStorage.getItem(themeKey);if(savedLocale==='ru'||savedLocale==='en'||savedLocale==='uz')setLocale(savedLocale);if(savedTheme==='dark'||savedTheme==='light')setTheme(savedTheme);}catch{/* Private browsing can disable storage. */}setLoaded(true);});return ()=>{alive=false;};},[]);
  useEffect(()=>{if(!loaded)return;document.documentElement.lang=locale;document.documentElement.dataset.theme=theme;try{localStorage.setItem(localeKey,locale);localStorage.setItem(themeKey,theme);}catch{/* Preferences still work for the current page. */}},[locale,theme,loaded]);
  return <PreferencesContext.Provider value={{locale,theme,setLocale,setTheme,t:(text)=>translate(text,locale)}}>{children}</PreferencesContext.Provider>;
}
export function usePreferences(){const preferences=useContext(PreferencesContext);if(!preferences)throw new Error('PreferencesProvider is required');return preferences;}
export function PreferenceControls(){const {locale,setLocale,theme,setTheme,t}=usePreferences();return <div className="preference-controls"><label className="preference-language"><span className="sr-only">Язык / Language</span><select aria-label="Язык / Language" value={locale} onChange={event=>{const next=event.target.value;if(next==='ru'||next==='en'||next==='uz')setLocale(next);}}><option value="ru">RU</option><option value="en">EN</option><option value="uz">Oʻzbek</option></select></label><button type="button" className="button subtle small preference-theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={t(theme==='dark'?'Включить светлую тему':'Включить тёмную тему')} title={t(theme==='dark'?'Включить светлую тему':'Включить тёмную тему')}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span><span>{t(theme==='dark'?'Светлая':'Тёмная')}</span></button></div>;}
