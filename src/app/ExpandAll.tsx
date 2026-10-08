"use client";

import { useEffect, useState } from "react";

const cardsOf = (list: string) => [...(document.getElementById(list)?.querySelectorAll("details") ?? [])];

/** Opens every card in the list, or closes them all when all are open, as the report's Expand all does. */
export function ExpandAll({ list }: { list: string }) {
    const [allOpen, setAllOpen] = useState(false);
    useEffect(() => {
        const root = document.getElementById(list);
        // A card's toggle event does not bubble, so the list listens in the capture phase.
        const sync = () => setAllOpen(cardsOf(list).length > 0 && cardsOf(list).every(d => d.open));
        root?.addEventListener("toggle", sync, true);
        return () => root?.removeEventListener("toggle", sync, true);
    }, [list]);
    return (
        <button
            type="button"
            onClick={() => {
                const open = !cardsOf(list).every(d => d.open);
                for (const d of cardsOf(list)) d.open = open;
                setAllOpen(open);
            }}
            className="text-sm font-medium text-indigo-700 hover:underline"
        >
            {allOpen ? "Collapse all" : "Expand all"}
        </button>
    );
}
