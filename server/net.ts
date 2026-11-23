import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import ipaddr from "ipaddr.js";
export async function publicBuffer(
  address: string,
  max = 2_000_000,
  depth = 0,
): Promise<Buffer> {
  const url = new URL(address);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    depth > 4
  )
    throw Error("网页地址无效");
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
  )
    throw Error("网页读取仅接受公网地址");
  return new Promise((resolve, reject) => {
    const fn = url.protocol === "https:" ? request : httpRequest;
    const req = fn(
      url,
      {
        headers: {
          "User-Agent": "StudyAgent/0.1",
          Accept: "text/html,application/json,text/plain",
        },
        lookup: ((_h: any, _o: any, cb: any) => {
          if (_o?.all) cb(null, [addresses[0]]);
          else cb(null, addresses[0].address, addresses[0].family);
        }) as any,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          publicBuffer(
            new URL(res.headers.location, url).href,
            max,
            depth + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error(`网页返回 ${res.statusCode}`));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (d) => {
          size += d.length;
          if (size > max) req.destroy(Error("网页内容过大"));
          else chunks.push(d);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.setTimeout(15000, () => req.destroy(Error("网页读取超时")));
    req.on("error", reject);
    req.end();
  });
}
export function plain(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .slice(0, 30000);
}

export async function publicGet(address:string,max=2_000_000,depth=0):Promise<string>{return (await publicBuffer(address,max,depth)).toString("utf8");}
