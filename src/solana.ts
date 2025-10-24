import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

export class SolanaWallet {
	private readonly keypair: Keypair;

	constructor(secretKeyBase58: string) {
		const secretKeyBytes = bs58.decode(secretKeyBase58);
		if (secretKeyBytes.length !== 64) {
			throw new Error(
				"SOLANA_PRIVATE_KEY must be a base58 encoded 64-byte secret key",
			);
		}
		this.keypair = Keypair.fromSecretKey(secretKeyBytes);
	}

	get address(): string {
		return this.keypair.publicKey.toBase58();
	}

	get publicKey(): PublicKey {
		return this.keypair.publicKey;
	}

	sign(message: Uint8Array): Uint8Array {
		const privateScalar = this.keypair.secretKey.slice(0, 32);
		return ed25519.sign(message, privateScalar);
	}

	signUtf8(message: string): Uint8Array {
		return this.sign(new TextEncoder().encode(message));
	}

	signBase58(message: Uint8Array | string): string {
		const bytes =
			typeof message === "string"
				? new TextEncoder().encode(message)
				: message;
		return bs58.encode(this.sign(bytes));
	}

	signVersionedTransaction(transaction: VersionedTransaction): VersionedTransaction {
		transaction.sign([this.keypair]);
		return transaction;
	}

	signAndEncodeTransaction(transaction: VersionedTransaction): string {
		const signed = this.signVersionedTransaction(transaction);
		return Buffer.from(signed.serialize()).toString("base64");
	}

	encodeBase58(value: Uint8Array | string): string {
		const bytes =
			typeof value === "string"
				? new TextEncoder().encode(value)
				: value;
		return bs58.encode(bytes);
	}
}


