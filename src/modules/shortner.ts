import Hashids from "hashids";
import "dotenv/config";
import db from "./db";

const hashids = new Hashids(process.env.HASHIDS_SALT, 6);

const module = {
    compress: async (url: string, owner: string, res: any): Promise<string | void> => {
        const {data, error} = await db.from("urls").insert([{
            url,
            owner_username: owner
        }]).select("id").maybeSingle();
        if (error || !data) return res.status(500).send({message: "internal server error"});

        const {id} = data;
        const encoded = hashids.encode(id);

        return encoded
    },
    decode_link: (encoded_data: string): {decoded: number, success: boolean} => {
        const decoded: Array<any> = hashids.decode(encoded_data);

        if (!decoded || !decoded.length) {
            return { decoded: 0, success: false };
        }

        return { decoded: decoded[0], success: true };
    },
    encode: (data: number) => {
        const encoded = hashids.encode(data);

        return encoded;
    }
};

export default module;