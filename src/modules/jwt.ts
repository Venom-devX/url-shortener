import jwt, { JwtPayload } from "jsonwebtoken";
import db from "./db";
import {readFileSync} from "fs";
import {join, dirname} from "path";
import {fileURLToPath} from "url";

type JwtData = {
    token_version: number
    username: string
    id: number
    email: string
}

type VerifyResult = {
    success: boolean
    data: JwtData | {}
}

type ProjectSettings = {
    port: number
    jwt_secret: string,
    jwt_refresh_secret: string,
    honeypot_logger: string
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_SETTINGS: ProjectSettings = JSON.parse(
    readFileSync(join(__dirname, "../../settings.json"), "utf8")
);

const module = {
    verify_access_token: async (token: string): Promise<VerifyResult> => {
        try {
            const decoded = jwt.verify(token, PROJECT_SETTINGS.jwt_secret, {
                algorithms: ["HS256"]
            }) as JwtPayload & JwtData;

            const data: JwtData = {
                token_version: decoded.token_version,
                username: decoded.username,
                id: decoded.id,
                email: decoded.email
            };

            const { data: user_data, error } = await db.from("users").select("token_version").eq("username", data.username).single();
            if (!user_data || error) return { success: false, data: {} };
            if (user_data.token_version !== data.token_version) return { success: false, data: {} };

            return { success: true, data };
        } catch {
            return { success: false, data: {} };
        }
    },
    create_access_token: (data: JwtData): { success: boolean, token?: string } => {
        try {
            const token = jwt.sign(data, PROJECT_SETTINGS.jwt_secret, {
                algorithm: "HS256",
                expiresIn: "15m"
            });
            return { success: true, token };
        } catch {
            return { success: false };
        }
    },

    verify_refresh_token: async (token: string): Promise<VerifyResult> => {
        try {
            const decoded = jwt.verify(token, PROJECT_SETTINGS.jwt_refresh_secret, {
                algorithms: ["HS256"]
            }) as JwtPayload & JwtData;

            const data: JwtData = {
                token_version: decoded.token_version,
                username: decoded.username,
                id: decoded.id,
                email: decoded.email
            };

            const { data: user_data, error } = await db.from("users").select("token_version").eq("username", data.username).single();
            if (!user_data || error) return { success: false, data: {} };
            if (user_data.token_version !== data.token_version) return { success: false, data: {} };

            return { success: true, data: data as JwtData };
        } catch {
            return { success: false, data: {} };
        }
    },
    create_refresh_token: (data: JwtData): { success: boolean, token?: string } => {
        try {
            const token = jwt.sign(data, PROJECT_SETTINGS.jwt_refresh_secret, {
                algorithm: "HS256",
                expiresIn: "30d"
            });
            return { success: true, token };
        } catch {
            return { success: false };
        }
    }
}

export default module;