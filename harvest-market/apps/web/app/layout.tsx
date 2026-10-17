import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={title:'BiotaPayFlow — Grow together',description:'BiotaPayFlow connects harvest funding with growers, investors, and buyers.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
