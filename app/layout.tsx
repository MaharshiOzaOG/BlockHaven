import type { Metadata } from 'next';
import './game.css';
export const metadata:Metadata={title:'Blockhaven · A little world, together',description:'An original multiplayer block-building playground. Create a world, invite a friend, and make something yours.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
