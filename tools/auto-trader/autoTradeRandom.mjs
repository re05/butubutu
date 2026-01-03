// tools/auto-trader/autoTradeRandom.mjs
// 目的: 2ユーザーで全果物の出品を作成し、ランダムな取引をN回「作成→承諾→発送→到着(Completed)」まで回す

const AUTH_URL    = process.env.AUTH_URL    || "http://localhost:4100";
const LISTING_URL = process.env.LISTING_URL || "http://localhost:4110";
const TRADE_URL   = process.env.TRADE_URL   || "http://localhost:4120";

const FRUITS = [1,2,3,4,5]; // fruit_item_id
const FRUIT_NAME = { 1:"リンゴ", 2:"バナナ", 3:"オレンジ", 4:"ぶどう", 5:"いちご" };

// 「ランダムだけど相場っぽい」モード
// USE_BIASED=1 のとき、基準レート(重み) + 少し揺らす
const USE_BIASED = String(process.env.USE_BIASED || "1") === "1";
const BASE_VALUE = { 1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0, 5: 5.0 }; // 例: バナナはリンゴの2倍、みたいな基準
const NOISE_PCT  = Number(process.env.NOISE_PCT || 10); // 10 = ±10%

const N = Number(process.env.N || 100);
const SEED_QTY = Number(process.env.SEED_QTY || 200000); // 出品初期在庫
const MAX_QTY  = Number(process.env.MAX_QTY  || 50);     // 1取引あたりの最大個数

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function http(method, url, { token, headers, body } = {}) {
  const h = { "Content-Type": "application/json", ...(headers || {}) };
  if (token) h["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${method} ${url}`);
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }
  return json;
}

async function registerOrLogin(user) {
  try {
    const reg = await http("POST", `${AUTH_URL}/register`, {
      body: {
        email: user.email,
        password: user.password,
        fullName: user.fullName,
        postalCode: "5300001",
        prefecture: "大阪府",
        city: "大阪市",
        addressLine: "テスト1-2-3",
        phone: "09000000000",
      }
    });
    return reg.token;
  } catch (e) {
    if (e.status === 409) {
      const login = await http("POST", `${AUTH_URL}/login`, {
        body: { email: user.email, password: user.password }
      });
      return login.token;
    }
    throw e;
  }
}

async function me(token) {
  return await http("GET", `${AUTH_URL}/me`, { token });
}

function wantsForFruit(fruitId) {
  // 1〜3必須なので、適当に3つ返す（自分以外）
  const other = FRUITS.filter(x => x !== fruitId);
  return other.slice(0, 3);
}

async function myListings(token) {
  const mine = await http("GET", `${LISTING_URL}/listings/mine`, { token });
  return Array.isArray(mine) ? mine : [];
}

async function createListing(token, fruitId, qty) {
  const created = await http("POST", `${LISTING_URL}/listings`, {
    token,
    body: {
      fruit_item_id: fruitId,
      quantity: qty,
      want_fruit_item_ids: wantsForFruit(fruitId),
      description: "auto-trader seed",
    }
  });
  return Number(created.id);
}

async function ensureAllFruitListings(token) {
  const mine = await myListings(token);
  const map = new Map(); // fruitId -> listingId

  for (const fruitId of FRUITS) {
    const exist = mine.find(x => Number(x.fruit_item_id) === fruitId && String(x.status) === "Active");
    if (exist) {
      map.set(fruitId, Number(exist.id));
      continue;
    }
    const id = await createListing(token, fruitId, SEED_QTY);
    map.set(fruitId, id);
  }
  return map;
}

async function createTrade(proposerToken, receiverId, giveListingId, giveQty, takeListingId, takeQty, message) {
  const t = await http("POST", `${TRADE_URL}/trades`, {
    token: proposerToken,
    body: {
      receiver_id: receiverId,
      proposal_message: message || "",
      give_items: [{ listing_id: giveListingId, quantity: giveQty }],
      take_items: [{ listing_id: takeListingId, quantity: takeQty }],
    }
  });
  return Number(t.id);
}

async function acceptTrade(receiverToken, tradeId) {
  await http("PATCH", `${TRADE_URL}/trades/${tradeId}/accept`, { token: receiverToken });
}
async function shipTrade(token, tradeId) {
  await http("PATCH", `${TRADE_URL}/trades/${tradeId}/ship`, { token });
}
async function receivedTrade(token, tradeId) {
  await http("PATCH", `${TRADE_URL}/trades/${tradeId}/received`, { token });
}

function decideQtyPair(fromFruit, toFruit) {
  // giveQty を 1..MAX_QTY でランダム
  const giveQty = randInt(1, MAX_QTY);

  if (!USE_BIASED) {
    // 完全ランダム（相場が散らかる）
    const takeQty = randInt(1, MAX_QTY);
    return { giveQty, takeQty };
  }

  // 基準レート: 1個(from) に対して何個(to) か
  const baseRate = BASE_VALUE[fromFruit] / BASE_VALUE[toFruit]; // 例: リンゴ(1) -> バナナ(2) = 0.5
  const noise = 1 + (randInt(-NOISE_PCT, NOISE_PCT) / 100);
  const rate = baseRate * noise;

  // takeQty = giveQty * rate を整数化（最低1）
  const takeQty = Math.max(1, Math.round(giveQty * rate));
  return { giveQty, takeQty };
}

async function completeTradeFlow({ proposerToken, receiverToken, proposerId, receiverId, giveListingId, takeListingId, fromFruit, toFruit, i }) {
  const { giveQty, takeQty } = decideQtyPair(fromFruit, toFruit);

  const tradeId = await createTrade(
    proposerToken,
    receiverId,
    giveListingId, giveQty,
    takeListingId, takeQty,
    `auto#${i} ${FRUIT_NAME[fromFruit]}${giveQty} -> ${FRUIT_NAME[toFruit]}${takeQty}`
  );

  await acceptTrade(receiverToken, tradeId);

  // 両者発送
  await shipTrade(proposerToken, tradeId);
  await shipTrade(receiverToken, tradeId);

  // 両者到着（Completed）
  await receivedTrade(proposerToken, tradeId);
  await receivedTrade(receiverToken, tradeId);

  return { tradeId, fromFruit, toFruit, giveQty, takeQty };
}

async function run() {
  const userA = { email: "botA@test.com", password: "pass", fullName: "Bot A" };
  const userB = { email: "botB@test.com", password: "pass", fullName: "Bot B" };

  const tokenA = await registerOrLogin(userA);
  const tokenB = await registerOrLogin(userB);

  const meA = await me(tokenA);
  const meB = await me(tokenB);

  const idA = Number(meA.id);
  const idB = Number(meB.id);

  // AとBの全果物出品を用意
  const listingsA = await ensureAllFruitListings(tokenA); // fruitId -> listingId
  const listingsB = await ensureAllFruitListings(tokenB);

  console.log(`A user=${idA}, B user=${idB}`);
  console.log(`USE_BIASED=${USE_BIASED} NOISE_PCT=${NOISE_PCT}% N=${N}`);

  for (let i = 1; i <= N; i++) {
    // ランダムに方向も変える（A→B と B→A を混ぜる）
    const flip = Math.random() < 0.5;

    const proposerToken = flip ? tokenA : tokenB;
    const receiverToken = flip ? tokenB : tokenA;
    const proposerId    = flip ? idA : idB;
    const receiverId    = flip ? idB : idA;
    const proposerListings = flip ? listingsA : listingsB;
    const receiverListings = flip ? listingsB : listingsA;

    // 交換元・交換先をランダム選択（同じ果物は避ける）
    const fromFruit = pick(FRUITS);
    let toFruit = pick(FRUITS);
    while (toFruit === fromFruit) toFruit = pick(FRUITS);

    const giveListingId = proposerListings.get(fromFruit);
    const takeListingId = receiverListings.get(toFruit);

    try {
      const r = await completeTradeFlow({
        proposerToken, receiverToken, proposerId, receiverId,
        giveListingId, takeListingId, fromFruit, toFruit, i
      });

      if (i % 10 === 0) {
        console.log(`done ${i}/${N}  ${FRUIT_NAME[r.fromFruit]}${r.giveQty} -> ${FRUIT_NAME[r.toFruit]}${r.takeQty}  trade=${r.tradeId}`);
      }
    } catch (e) {
      console.error(`FAILED i=${i}`, e.message);
      console.error(e.body ?? e);

      // よくある失敗: 在庫不足/Activeでない/所有者チェックなど
      // いったん少し待って次へ
      await sleep(200);
    }
  }

  console.log("all done");
}

run().catch(e => {
  console.error("FATAL:", e.message);
  console.error(e.body ?? e);
  process.exit(1);
});
