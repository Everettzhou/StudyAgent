import forge from "node-forge";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { randomBytes, createHash } from "node:crypto";
export function addresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (x): x is NonNullable<typeof x> =>
        !!x &&
        x.family === "IPv4" &&
        !x.internal &&
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address),
    )
    .map((x) => x.address);
}
export function credentials(dir: string) {
  mkdirSync(dir, { recursive: true });
  const caFile = join(dir, "ca.crt"),
    keyFile = join(dir, "ca.key");
  let ca: any, keys: any;
  if (existsSync(caFile)) {
    ca = forge.pki.certificateFromPem(readFileSync(caFile, "utf8"));
    keys = {
      privateKey: forge.pki.privateKeyFromPem(readFileSync(keyFile, "utf8")),
    };
  } else {
    keys = forge.pki.rsa.generateKeyPair(2048);
    ca = forge.pki.createCertificate();
    ca.publicKey = keys.publicKey;
    ca.serialNumber = "01" + randomBytes(12).toString("hex");
    ca.validity.notBefore = new Date(Date.now() - 86400000);
    ca.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400000);
    ca.setSubject([{ name: "commonName", value: "Zhixu Local Learning CA" }]);
    ca.setIssuer(ca.subject.attributes);
    ca.setExtensions([
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true },
    ]);
    ca.sign(keys.privateKey, forge.md.sha256.create());
    writeFileSync(caFile, forge.pki.certificateToPem(ca));
    writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey), {
      mode: 0o600,
    });
  }
  const leaf = forge.pki.rsa.generateKeyPair(2048),
    cert = forge.pki.createCertificate();
  cert.publicKey = leaf.publicKey;
  cert.serialNumber = "02" + randomBytes(12).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  cert.setSubject([{ name: "commonName", value: "localhost" }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        ...["127.0.0.1", ...addresses()].map((ip) => ({ type: 7, ip })),
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  return {
    key: forge.pki.privateKeyToPem(leaf.privateKey),
    cert: pem,
    ca: forge.pki.certificateToPem(ca),
    fingerprint: createHash("sha256")
      .update(
        Buffer.from(
          forge.asn1.toDer(forge.pki.certificateToAsn1(ca)).getBytes(),
          "binary",
        ),
      )
      .digest("hex")
      .match(/../g)!
      .join(":"),
  };
}
