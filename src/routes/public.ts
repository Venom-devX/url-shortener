import {Router} from "express";
import {RateLimiterMemory} from "rate-limiter-flexible";
import {z} from "zod";
import {genSalt, hash, compare} from "bcrypt";
import db from "../modules/db";
import jwt from "../modules/jwt";
import shortner from "../modules/shortner";

type JwtData = {
    token_version: number
    username: string
    id: number
    email: string
};

const RateLimiter = new RateLimiterMemory({
    duration: 60 * 60 * 24,
    points: 1
})
const click_limiter = new RateLimiterMemory({
    points: 1,
    duration: 60 * 60
})

const USERNAME_REGEX = /^(?!_)(?!.*__)[a-zA-Z0-9_]{3,20}(?<!_)$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com|protonmail\.com|proton\.me)$/;

const sign_up_schema = z.object({
    username: z.string().regex(USERNAME_REGEX).max(20),
    email: z.string().regex(EMAIL_REGEX).max(50),
    password: z.string().min(4).max(50),
    role: z.string()
});
const refresh_schema = z.object({
    authorization: z.string().min(64).max(2000)
});
const login_schema = z.object({
    email: z.string().regex(EMAIL_REGEX).max(50),
    password: z.string().min(4).max(50)
})

const app = Router();

app.get("/URLs/:encoded_url", async (req, res) => {
    const {encoded_url} = req.params;
    const parsed = shortner.decode_link(encoded_url);
    
    if (!parsed.success) return res.status(404).send({message: "shortned url not found."});

    const {data, error} = await db.from("urls").select("url, clicks").eq("id", parsed.decoded).maybeSingle();
    if (!data) return res.status(404).send({message: "shortned url not found."});
    if (error) return res.status(500).send({message: "internal server error"});

    try {
        await click_limiter.consume(`${req.ip}_${encoded_url}`);
        
        const {data: update_data, error: search_err} = await db.from("urls").update({
            clicks: data.clicks + 1
        }).eq("id", parsed.decoded).select().maybeSingle();
        if (!update_data || search_err) return res.status(500).send({message: "unexpected error"});

    } catch {};

    return res.redirect(data.url);
})

app.post("/v1/users/sign-up", async (req, res) => {
    const parsed = sign_up_schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).send({message: "bad request"});
    }
    
    try {
        await RateLimiter.consume(req.ip as string);
    } catch {
        return res.status(429).send({message: "too many requests"})
    }

    let {username, email, password, role} = req.body as {username: string, email: string, password: string, role: string};
    username = username.toLowerCase().trim();
    email = email.toLowerCase().trim();

    /* Honeypot lmaooo */
    if (role !== "user") {
        const {data, error} = await db.from("blacklist").insert([{
            ip: req.ip
        }]).select().maybeSingle();
        if (!data || error) return res.status(500).send({message: "internal server error"});
        return res.status(201).send({message: "successfully created your user", token: "67auramangosohio"});
    }
    const salt = await genSalt(12);
    const hashed_password = await hash(password, salt);

    const {data, error} = await db.from("users").insert([{
        email,
        username,
        password: hashed_password,
        token_version: 0
    }]).select("id").maybeSingle();
    if (error && error.code == "23505") {
        return res.status(401).send({message: "username or email is already exists"});
    }
    if (error) {
        return res.status(500).send({message: "internal server error"})
    }
    if (!data) {
        return res.status(500).send({message: "failed to insert your users in database"})
    }

    const {id} = data;
    const jwt_data = jwt.create_refresh_token({
        email,
        id,
        username,
        token_version: 0
    });
    if (!jwt_data.success) return res.status(500).send({message: "failed to create your token"});

    return res.status(201).send({message: "successfully sign up", token: jwt_data.token});
})
app.post("/v1/users/login", async (req, res) => {
    const parsed = login_schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    const {email, password} = parsed.data;
    
    const {data, error} = await db.from("users").select("password, id, username, token_version").eq("email", email).maybeSingle();
    if (error) return res.status(500).send({message: "internal server error"});
    if (!data) return res.status(404).send({message: "invalid credentials"});

    const is_password_valid = await compare(password, data.password);
    if (!is_password_valid) return res.status(404).send({message: "invalid credentials"});

    const {username, id, token_version} = data;
    const jwt_data = jwt.create_refresh_token({
        email,
        username,
        id,
        token_version
    });

    if (!jwt_data.success) return res.status(500).send({message: "internal server error"});

    return res.status(200).send({message: "successfully logged in", token: jwt_data.token});
})

app.patch("/v1/users/refresh", async (req, res) => {
    const parsed = refresh_schema.safeParse({authorization: req.headers.authorization});
    if (!parsed.success) return res.status(400).send({message: "Bad request"});

    let {authorization} = parsed.data;
    if (authorization.startsWith("Bearer ")) authorization = authorization.slice(7);

    const decoded = await jwt.verify_refresh_token(authorization);
    if (!decoded.success) return res.status(401).send({message: "this refresh token is invalid"});

    const data = jwt.create_access_token(decoded.data as JwtData);
    if (!data.success) return res.status(500).send({message: "failed to refresh your access token"});

    return res.status(200).send({message: "successfully refreshed your access token", data: data.token});
})

export default app;