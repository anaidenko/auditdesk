"use server";

import { revalidatePath } from "next/cache";

import { saveCheck } from "@/server/evals";

/** Andrii's call on one judged finding of an eval result. */
export async function spotCheck(file: string, label: string, formData: FormData) {
    await saveCheck(file, label, { agree: formData.get("agree") === "yes", note: String(formData.get("note") ?? "") });
    revalidatePath(`/evals/${file}`);
    revalidatePath("/evals");
}
