import {createClient} from "@supabase/supabase-js";
(await import("dotenv")).config();

const DB_URL = process.env.DB_URL as string
const DB_SECRET = process.env.DB_SECRET as string;
const client = createClient(DB_URL, DB_SECRET);

export default client;