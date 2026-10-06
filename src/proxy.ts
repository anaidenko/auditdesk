import { type NextRequest, NextResponse } from "next/server";

import { isAllowedHost } from "@/server/host";

export function proxy(request: NextRequest) {
    if (!isAllowedHost(request.headers.get("host"))) return new NextResponse("Forbidden host", { status: 403 });
    return NextResponse.next();
}

// Every path: Server Actions post to the page's own path, so no page may be left out (design § 12).
export const config = { matcher: "/:path*" };
