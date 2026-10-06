/** The event's time in the viewer's time zone: the server stores UTC. */
export function clockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}
