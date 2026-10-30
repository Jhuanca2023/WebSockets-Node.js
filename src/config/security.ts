import 'dotenv/config';

function requiredSecret(name: string): string {
    const value = process.env[name];
    if (!value || value.trim().length < 32 || ['secret', 'refresh_secret'].includes(value)) {
        throw new Error(name + ' debe configurarse con un secreto aleatorio de al menos 32 caracteres');
    }
    return value;
}

export const JWT_SECRET = requiredSecret('JWT_SECRET');
export const JWT_REFRESH_SECRET = requiredSecret('JWT_REFRESH_SECRET');
if (JWT_SECRET === JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos');
}
