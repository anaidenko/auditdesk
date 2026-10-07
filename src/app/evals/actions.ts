"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/app/actions";
import { saveCheck } from "@/server/evals";

/** Andrii's call on one judged finding of an eval result; a refused save comes back as text for the form. */
export async function spotCheck(file: string, label: string, _prev: FormState, formData: FormData): Promise<FormState> {
    try {
        await saveCheck(file, label, { agree: formData.get("agree") === "yes", note: String(formData.get("note") ?? "") });
    } catch (e) {
        return { error: (e as Error).message };
    }
    revalidatePath(`/evals/${encodeURIComponent(file)}`);
    revalidatePath("/evals");
    return { error: null };
}
