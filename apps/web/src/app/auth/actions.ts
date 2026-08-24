"use server";

import { authCredentialsSchema } from "@manager/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthActionState {
  errors?: { email?: string[]; password?: string[] };
  message?: string;
  success?: boolean;
}

export async function authenticate(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = authCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const intent = formData.get("intent") === "sign-up" ? "sign-up" : "sign-in";

  if (intent === "sign-up") {
    const { data, error } = await supabase.auth.signUp(parsed.data);

    if (error) {
      return { message: error.message };
    }

    if (!data.session) {
      return {
        message: "Account created. Check your email to confirm your address, then sign in.",
        success: true,
      };
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      return { message: "Email or password is incorrect." };
    }
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth");
}
