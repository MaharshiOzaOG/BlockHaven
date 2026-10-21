import type { Metadata } from 'next';
import './game.css';
export const metadata:Metadata={title:'Blockhaven · Survive the frontier together',description:'A small-group survival sandbox with crafting, crops, combat, and shared meteor storms.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
