import { json, route } from "@/lib/server/http";
import { publicUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user }) => json({ user: user ? publicUser(user) : null }));
