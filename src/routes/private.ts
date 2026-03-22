import {Router, Request} from "express";
import shortner from "../modules/shortner";
import db from "../modules/db";
import {z} from "zod";
import {compare, genSalt, hash} from "bcrypt";
import {RateLimiterMemory} from "rate-limiter-flexible";

const app = Router();

type user_data = {
    token_version: number
    username: string
    id: number
    email: string
};
type authenticated_request = Request & {user_data: user_data};

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com|protonmail\.com|proton\.me)$/;

const short_limiter = new RateLimiterMemory({
    points: 5,
    duration: 60 * 60 * 24
})
app.post("/v1/shortner/short-url", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const schema = z.object({
        url: z.string().min(4).max(2048).refine(val => {
            try {
                new URL(val.startsWith("http") ? val : "https://" + val);
                return true;
            } catch {
                return false;
            }
        }, {
            message: "invalid url"
        })
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    try {
        const ip = req.ip as string;
        await short_limiter.consume(ip);
    } catch {
        return res.status(429).send({message: "too many requests"});
    }
    
    const {url} = parsed.data;
    const compressed_id = await shortner.compress(url, username, res);
    if (!compressed_id) return;
    
    const {protocol, host} = req;
    return res.status(201).send({message: "successfully created url", url: `${protocol}://${host}/URLs/${compressed_id}`})
})
app.delete("/v1/shortner/short-url", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const schema = z.object({
        url_id: z.string().min(6)
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    let {url_id: encoded_id} = parsed.data;
    const {success, decoded: url_id} = shortner.decode_link(encoded_id);
    if (!success) return res.status(404).send({message: "url not found"});

    const {data, error} = await db.from("urls").delete().eq("id", url_id).eq("owner_username", username).select().maybeSingle();
    if (error) return res.status(500).send({message: "failed to delete the shortned url."});
    if (!data) return res.status(404).send({message: "url not found"});

    return res.status(200).send({message: "successfully deleted the selected short url"});
})

app.patch("/v1/shortner/short-url", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const schema = z.object({
        url_id: z.string().min(6),
        new_url: z.string().min(4).max(2048).refine(val => {
            try {
                new URL(val.startsWith("http") ? val : "https://" + val);
                return true;
            } catch {
                return false;
            }
        }, {
            message: "invalid url"
        })
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    let {url_id: encoded_id, new_url} = parsed.data;
    const {success, decoded: url_id} = shortner.decode_link(encoded_id);
    if (!success) return res.status(404).send({message: "url not found"});

    const {data, error} = await db
    .from("urls")
    .update({
        url: new_url
    })
    .eq("id", url_id)
    .eq("owner_username", username)
    .select().maybeSingle();

    if (error) return res.status(500).send({message: "failed to update the shortned url."});
    if (!data) return res.status(404).send({message: "url not found"});

    return res.status(200).send({message: "successfully updated the selected short url"});
})

app.get("/v1/shortner/stats/:short_url", async (req: Request, res) => {
    const {short_url} = req.params as {short_url: string};
    const {success, decoded: url_id} = shortner.decode_link(short_url);
    if (!success) return res.status(404).send({message: "short url not found"});

    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("urls").select("clicks").eq("owner_username", username).eq("id", url_id).maybeSingle();
    if (error) return res.status(500).send({message: "internal server error"});
    if (!data) return res.status(404).send({message: "short url not found"});

    const {clicks} = data;
    return res.status(200).send({message: "successfully caught the short url stats", clicks});
})

app.get("/v1/shortner/my-urls", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("urls").select("id, url, clicks").eq("owner_username", username);
    if (!data || error) return res.status(500).send({message: "internal server error"});

    const search_result = data.map(v => {
        const original_url = v.url;
        const shortned_url = `${req.protocol}://${req.host}/URLs/${shortner.encode(v.id)}`;
        const clicks = v.clicks;

        return {original_url, shortned_url, clicks}
    });

    return res.status(200).send({message: "successfully caught your urls", data: search_result})
})

app.get("/v1/shortner/my-urls/:encoded_id", async (req: Request, res) => {
    const typed_req = req as authenticated_request;
    let {encoded_id} = req.params;
    encoded_id = encoded_id as string;

    const {username} = typed_req.user_data;
    const {success, decoded: url_id} = shortner.decode_link(encoded_id);
    if (!success) return res.status(404).send({message: "url invalid"});

    const {data, error} = await db.from("urls").select("url, clicks").eq("owner_username", username).eq("id", url_id).maybeSingle();
    if (error) return res.status(500).send({message: "internal server error"});
    if (!data) return res.status(404).send({message: "url invalid"});
    
    const url_data = {
        original_url: data.url,
        short_url: `${req.protocol}://${req.host}/URLs/${encoded_id}`,
        clicks: data.clicks
    };

    return res.status(200).send({message: "successfully caught url data", data: url_data});
})

app.get("/v1/shortner/my-urls/search", async (req, res) => {
    const schema = z.object({
        query: z.string().min(1).max(2048)
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    const {query} = parsed.data;
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;
    
    const {data, error} = await db.from("urls").select("url, id, clicks").eq("owner_username", username).ilike("url", `%${query}%`);
    if (!data?.length) return res.status(404).send({message: "not found", data: []});
    if (error) return res.status(500).send({message: "internal server error", data: []});

    const result = data.map(v => {
        const original_url = v.url;
        const shortned_url = `${req.protocol}://${req.host}/URLs/${shortner.encode(v.id)}`;
        const clicks = v.clicks;

        return {original_url, shortned_url, clicks};
    });

    return res.status(200).send({message: "successfully caught urls by query", data: result});
})

app.patch("/v1/users/my-self/reset-password", async (req, res) => {
    const schema = z.object({
        current_password: z.string().min(4).max(50),
        new_password: z.string().min(4).max(50)
    })

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    const {current_password, new_password} = parsed.data;
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("users").select("password, token_version").eq("username", username).maybeSingle();
    if (!data || error) return res.status(500).send({message: "internal server error"});

    const is_password_valid = await compare(current_password, data.password);
    if (!is_password_valid) return res.status(401).send({message: "password is invalid"});

    const salt = await genSalt(12);
    const hashed_password = await hash(new_password, salt);

    const {data: update_data, error: update_err} = await db.from("users").update({
        password: hashed_password,
        token_version: data.token_version + 1
    }).eq("username", username).eq("password", data.password).select().maybeSingle();
    if (!update_data || update_err) return res.status(500).send({message: "internal server error"});

    return res.status(200).send({message: "successfully reseted your password!"})
})

app.patch("/v1/users/my-self/edit-profile", async (req, res) => {
    const schema = z.object({
        new_email: z.string().regex(EMAIL_REGEX),
        current_password: z.string().min(4).max(40)
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "Bad request"});

    const {new_email, current_password} = parsed.data;
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("users").select().eq("username", username).maybeSingle();
    if (!data || error) return res.status(500).send({message: "internal server error"});

    const is_password_valid = await compare(current_password, data.password);
    if (!is_password_valid) return res.status(401).send({message: "password is invalid"});

    const {data: update_data, error: update_err} = await db.from("users").update({
        email: new_email
    }).eq("username", username).eq("password", data.password).select().maybeSingle();
    if (!update_data || update_err) return res.status(500).send({message: "internal server error"});

    return res.status(200).send({message: "successfully edited your profile!"})
})
app.get("/v1/users/my-self/profile", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("users").select("id, username, email").eq("username", username).maybeSingle();
    if (error || !data) return res.status(500).send({message: "internal server error"});

    return res.status(200).send({message: "successfully caught your profile.", data});
})

app.post("/v1/auth/logout", async (req, res) => {
    const schema = z.object({
        current_password: z.string().min(4).max(50)
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    const {current_password} = parsed.data;

    const typed_req = req as authenticated_request;
    const {username, id, token_version} = typed_req.user_data;

    const {data: user_data, error: user_search_error} = await db.from("users").select("password").eq("username", username).eq("id", id).maybeSingle();
    if (!user_data || user_search_error) return res.status(500).send({message: "unexpected error"});

    const is_password_valid = await compare(current_password, user_data.password);
    if (!is_password_valid) return res.status(401).send({message: "password is invalid"});

    const {data, error} = await db.from("users").update({
        token_version: token_version + 1
    }).eq("username", username).eq("id", id).eq("token_version", token_version).select().maybeSingle();
    if (!data || error) return res.status(500).send({message: "unexpected error"});

    return res.status(200).send({message: "successfully logout"});
})

app.patch("/v1/shortner/favorite", async (req, res) => {
    const schema = z.object({
        url: z.string().min(6).max(20),
        toggle: z.boolean()
    });
    
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({message: "bad request"});

    const {url, toggle} = parsed.data;

    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const url_parse = shortner.decode_link(url);
    if (!url_parse.success) return res.status(404).send({message: "invalid url"});

    const url_id = url_parse.decoded;
    const {data, error} = await db.from("urls").update({
        favorited: toggle
    }).eq("id", url_id).select().maybeSingle();

    if (error) return res.status(500).send({message: "internal server error"});
    if (!data) return res.status(404).send({message: "invalid url"});

    return res.status(200).send({message: (toggle ? "successfully favorited the short url." : "successfully unfavorited the short url")})
})
app.get("/v1/shortner/favorite", async (req, res) => {
    const typed_req = req as authenticated_request
    const {username} = typed_req.user_data;

    const {data, error} = await db.from("urls").select("url, id, clicks").eq("favorited", true).eq("owner_username", username);
    if (error) return res.status(500).send({message: "internal server error", data: []});
    if (!data?.length) return res.status(404).send({message: "you have no favorited urls", data: []});

    const result = data.map(v => {
        const original_url = v.url;
        const shortned_url = `${req.protocol}://${req.host}/URLs/${shortner.encode(v.id)}`;
        const clicks = v.clicks;

        return {original_url, shortned_url, clicks};
    });

    return res.status(200).send({message: "successfully caught your favorite urls", data: result});
})

export default app;