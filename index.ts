import express, {Request, Response, NextFunction} from "express";
import {fileURLToPath} from "url";
import {join, dirname} from "path";
import {readFileSync} from "fs";
import jwt from "./src/modules/jwt";
import cors from "cors";
import {RateLimiterMemory} from "rate-limiter-flexible";
import db from "./src/modules/db";

const app = express();

const __dirname = dirname(fileURLToPath(import.meta.url));
type ProjectSettings = {
    port: number
    jwt_secret: string,
    jwt_refresh_secret: string,
    honeypot_logger: string
};

const PROJECT_SETTINGS: ProjectSettings = JSON.parse(
    readFileSync(join(__dirname, "./settings.json"), "utf8")
);

type user_data = {
    token_version: number
    username: string
    id: number
    email: string
};
type authenticated_request = Request & {user_data: user_data};

const private_routes_middleware = async (req: Request, res: Response, next: NextFunction) => {
    let {authorization} = req.headers;
    if (!authorization) return res.status(401).send({message: "unauthorized"});
    if (typeof authorization !== "string") return res.status(401).send({message: "unauthorized"});

    if (authorization.startsWith("Bearer ")) {
        authorization = authorization.slice(7);
    }

    const result = await jwt.verify_access_token(authorization);
    if (!result.success) return res.status(401).send({message: "unauthorized"});

    const typed_req = req as authenticated_request;
    typed_req.user_data = result.data as user_data;
    
    return next();
};

const public_routes = (await import("./src/routes/public")).default;
const private_routes = (await import("./src/routes/private")).default;

const rate_limiter = new RateLimiterMemory({
    points: 40,
    duration: 60
});

app.use(cors());
app.use(async (req, res, next) => {
    try {
        const ip = req.ip as string;
        await rate_limiter.consume(ip);
    } catch {
        return res.status(429).send({message: "too many requests"});
    }
    
    return next();
});

app.use(express.json());
app.use(async (req, res, next) => {
    const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
    req.ip;
    
    const {data, error} = await db.from("blacklist").select("id").eq("ip", ip).maybeSingle();
    if (error) {
        return res.status(500).send({message: "internal server error"});
    }
    if (data) {
        const status = Math.random() > 0.5;
        return res.status(
            status ? 403 : 404
        ).send({ message: status ? "forbidden" : "not found" });
    }

    return next();
})
app.use(public_routes);
app.use(private_routes_middleware, private_routes);

const port = PROJECT_SETTINGS.port || 80;
app.listen(port, (): void => {
    return console.log(`Server rodando na porta ${String(port)}`);
})