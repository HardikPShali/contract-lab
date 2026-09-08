import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"Contract Lab | Catch Breaking API Changes",description:"Compare API schemas, test requests and catch breaking changes before release.",other:{"codex-preview":"development"},icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
