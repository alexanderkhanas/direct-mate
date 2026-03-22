declare const _default: () => {
    nodeEnv: string;
    port: number;
    database: {
        url: string | undefined;
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    meta: {
        appSecret: string;
        webhookVerifyToken: string;
    };
    openai: {
        apiKey: string;
        model: string;
    };
    internal: {
        apiKey: string;
    };
};
export default _default;
