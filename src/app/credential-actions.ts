"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/app/actions";
import { CredentialError, removeCredential, saveCredential } from "@/engine/credentials";
import type { ModelAccess } from "@/engine/types";

const ACCESSES: readonly ModelAccess[] = ["claude_plan", "api_key"];

/** Returns only an error text: the value never travels back to the browser. */
export async function saveCredentialAction(access: ModelAccess, _prev: FormState, fd: FormData): Promise<FormState> {
    if (!ACCESSES.includes(access)) return { error: "Unknown credential." };
    try {
        await saveCredential(access, String(fd.get("value") ?? ""));
    } catch (e) {
        if (e instanceof CredentialError) return { error: e.message };
        throw e;
    }
    revalidatePath("/", "layout");
    return { error: null };
}

export async function removeCredentialAction(access: ModelAccess): Promise<void> {
    if (!ACCESSES.includes(access)) return;
    await removeCredential(access);
    revalidatePath("/", "layout");
}
