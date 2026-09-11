#!/usr/bin/env bash
# PRD §27 Phase P3 — deploy settlement and take it through a real payout.
#
# §28 item 3 asks for "a live sample, a real breach, and a real payout, all on
# Shannon, all linked and re-derivable". The first two are already on chain from
# the earlier run. This produces the third, which needs a fresh registry and
# subscriber because both are immutably wired to each other.
#
# Run the stages in order. Each verifies what it did before returning, and each
# is safe to re-read afterwards — nothing here is idempotent, so do not re-run a
# stage that succeeded.
#
#   ./scripts/p3-live-run.sh deploy    # contracts, commitment, subscription
#   ./scripts/p3-live-run.sh trade     # quote, get taken, then breach
#   ./scripts/p3-live-run.sh claim     # after the window closes
#
# Requires .env.local (gitignored, mode 0600) and foundry on PATH.

set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env.local; set +a

R="$SOMNIA_RPC_URL"
DEPLOYER=0xF3F0C3fB033e97F6f09BAe7F52329a8825167054
MAKER=0x62Ec9c9410c1b59647749D4d3005c75b9F380F38
POOL=$(node -p "JSON.parse(require('fs').readFileSync('deployments/somnia-shannon-50312.json')).measurement.dreamdexPool")
MARKET=$(node -p "JSON.parse(require('fs').readFileSync('deployments/somnia-shannon-50312.json')).measurement.marketId")
TUSDC=0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E
STATE=deployments/p3-run.env

# The envelope. Spread is in raw price units, the same scale the book quotes in.
MAX_SPREAD=15000        # the maker's quotes sit 10000 apart, so this holds
MIN_SIZE=10000000       # 10 tUSDC
BOND=1000000000000000000  # 1 STT

# Quotes chosen to sit strictly inside the live book so they rest rather than
# take, and become best on both sides so the sample measures OUR maker.
BID_PX=845000
ASK_PX=855000
QUOTE_QTY=50000000      # 50 tUSDC
TAKE_QTY=5000000        # 5 tUSDC, well under the quote so minSize still holds

ORDER_PLACED_TOPIC=0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
die()  { printf '  FAIL  %s\n' "$*" >&2; exit 1; }

# Pull the order id out of a receipt's OrderPlaced log.
order_id_from() {  # $1 = tx hash, $2 = expected placer
  cast receipt "$1" --rpc-url "$R" --json 2>/dev/null \
    | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          const r=JSON.parse(s);
          const t=process.argv[1].toLowerCase();
          const log=(r.logs||[]).find(l=>(l.topics||[])[0]?.toLowerCase()===t);
          if(!log){process.stderr.write("no OrderPlaced log in receipt\n");process.exit(1);}
          process.stdout.write(BigInt(log.topics[1]).toString());
        });' "$ORDER_PLACED_TOPIC"
}

wait_for_block() {  # $1 = target block
  local target=$1 now
  while :; do
    now=$(cast block-number --rpc-url "$R")
    if [ "$now" -ge "$target" ]; then break; fi
    printf '\r  waiting for block %s, now %s (%s to go)   ' "$target" "$now" "$((target - now))"
    sleep 5
  done
  printf '\r  reached block %s%*s\n' "$now" 30 ''
}

# ---------------------------------------------------------------- deploy ----
stage_deploy() {
  say "P3 stage 1 — deploy"

  local n reg sub head start end
  n=$(cast nonce "$DEPLOYER" --rpc-url "$R")
  reg=$(cast compute-address "$DEPLOYER" --nonce "$n"       | awk '{print $NF}')
  sub=$(cast compute-address "$DEPLOYER" --nonce "$((n+1))" | awk '{print $NF}')
  ok "registry will be   $reg"
  ok "subscriber will be $sub"

  # 1. Registry, taking the predicted subscriber as an immutable.
  cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" \
    --create "$(forge inspect AssizeRegistry bytecode)$(cast abi-encode 'c(address)' "$sub" | sed 's/^0x//')" \
    >/dev/null
  [ "$(cast code "$reg" --rpc-url "$R" | wc -c)" -gt 10 ] || die "registry has no code"
  ok "registry deployed"

  # 2. The commitment, from the maker, with the bond as value. The window has to
  #    start far enough ahead that the rest of this stage lands before it opens:
  #    blocks are 100ms, so a few hundred is seconds.
  head=$(cast block-number --rpc-url "$R")
  start=$((head + 3000))
  end=$((start + 9000))
  cast send --private-key "$MAKER_PRIVATE_KEY" --rpc-url "$R" --value "$BOND" "$reg" \
    "publishCommitment(bytes32,uint128,uint128,uint64,uint64)" \
    "$MARKET" "$MAX_SPREAD" "$MIN_SIZE" "$start" "$end" >/dev/null
  [ "$(cast call "$reg" 'commitmentCount()(uint256)' --rpc-url "$R" | cut -d' ' -f1)" = "1" ] \
    || die "commitment was not published"
  ok "commitment 0 published, window $start -> $end"

  # 3. Subscriber, asserting the prediction held.
  cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" \
    --create "$(forge inspect CoverageSubscriber bytecode)$(cast abi-encode 'c(address,address,uint256)' "$POOL" "$reg" 0 | sed 's/^0x//')" \
    >/dev/null
  [ "$(cast code "$sub" --rpc-url "$R" | wc -c)" -gt 10 ] || die "subscriber not at the predicted address"
  [ "$(cast call "$reg" 'subscriber()(address)' --rpc-url "$R")" = "$sub" ] || die "registry points elsewhere"
  ok "subscriber deployed and wired"

  # Record the addresses NOW. The first run of this script lost them when a
  # later step failed, and a deployed contract whose address is only in a
  # terminal scrollback is a contract you can lose.
  { echo "REG=$reg"; echo "SUB=$sub"; echo "START=$start"; echo "END=$end"; } > "$STATE"
  ok "addresses written to $STATE"

  fund_and_subscribe "$reg" "$sub"

  say "stage 1 done. Window opens at $start."
  echo "  Next:  ./scripts/p3-live-run.sh trade"
}

# Fund the subscriber to the library's own floor and subscribe. Separate from
# the deploy so a failure here can be retried without redeploying anything.
fund_and_subscribe() {
  local reg=$1 sub=$2

  # SUBSCRIPTION_OWNER_MINIMUM_BALANCE is 32 ether in the pinned library, and it
  # is checked at subscribe time. The first run funded 20 and was refused with
  # InsufficientBalance (0xf4d678b8). Read the floor from the package rather
  # than writing a number here, so it cannot drift from what the code enforces.
  local floor held need
  floor=$(grep -oE 'SUBSCRIPTION_OWNER_MINIMUM_BALANCE = [0-9]+ ether' \
            node_modules/@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol \
            | grep -oE '[0-9]+' | head -1)
  [ -n "$floor" ] || die "could not read SUBSCRIPTION_OWNER_MINIMUM_BALANCE from the pinned package"
  held=$(cast balance "$sub" --rpc-url "$R")
  need=$(python3 -c "print(max(0, $floor*10**18 + 10**18 - $held))")
  ok "owner minimum is ${floor} STT; subscriber holds $(cast from-wei "$held")"

  if [ "$need" != "0" ]; then
    cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" --value "$need" "$sub" >/dev/null
    ok "topped up by $(cast from-wei "$need") STT to $(cast from-wei "$(cast balance "$sub" --rpc-url "$R")")"
  fi

  # Size gasLimit from the REAL pool, never a fixture (D-022).
  local measured limit
  measured=$(cast estimate "$sub" "onEvent(address,bytes32[],bytes)" "$POOL" "[]" "0x" \
              --from 0x0000000000000000000000000000000000000100 --rpc-url "$R")
  limit=$(( measured * 2 ))
  ok "handler gas measured against the live pool: $measured, using $limit"

  local Z=0x0000000000000000000000000000000000000000000000000000000000000000
  cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" "$sub" \
    "subscribe(bytes32[4],(uint64,uint64,uint64))(uint256)" "[$Z,$Z,$Z,$Z]" "(0,20000000000,$limit)" >/dev/null
  local subid
  subid=$(cast call "$sub" 'subscriptionId()(uint256)' --rpc-url "$R" | cut -d' ' -f1)
  [ "$subid" != "0" ] || die "subscribe did not take"
  ok "subscription $subid live"

  # Auto-pull needs an allowance: this pool's collateral is tUSDC, not native.
  for who in MAKER DEPLOYER; do
    local key="${who}_PRIVATE_KEY"
    cast send --private-key "${!key}" --rpc-url "$R" "$TUSDC" \
      "approve(address,uint256)" "$POOL" 10000000000 >/dev/null
  done
  ok "tUSDC approved to the pool by both accounts"

  { echo "SUBID=$subid"; } >> "$STATE"
  say "subscription $subid live."
}

# ----------------------------------------------------------------- trade ----
stage_trade() {
  . "$STATE"
  say "P3 stage 2 — quote, get taken, then breach"
  wait_for_block "$START"

  local expire bidtx asktx bidid askid taketx takeid
  expire=$(( ($(date +%s) + 3600) * 1000000000 ))

  # Prices are derived from the book as it stands RIGHT NOW, not written above.
  # The first attempt hardcoded 845000/855000 from a reading taken ten minutes
  # earlier; by the time the window opened the book had moved to 900000/922000,
  # which put the maker's "ask" below the best bid — a POST_ONLY order that
  # cannot rest without taking, so it is simply refused. A quote that has to sit
  # inside a live spread has to be computed against that spread.
  local bb ba mid half
  bb=$(cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" true 1 --rpc-url "$R" \
        | grep -oE '[0-9]+' | head -1)
  ba=$(cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" false 1 --rpc-url "$R" \
        | grep -oE '[0-9]+' | head -1)
  [ -n "$bb" ] && [ -n "$ba" ] || die "could not read the book"
  [ "$ba" -gt "$bb" ] || die "book is crossed: bid $bb, ask $ba"
  ok "live book: bid $bb, ask $ba, spread $((ba - bb))"

  # Sit symmetrically inside the spread, tight enough that the envelope holds.
  mid=$(( (bb + ba) / 2 ))
  half=5000
  BID_PX=$(( mid - half ))
  ASK_PX=$(( mid + half ))
  [ "$BID_PX" -gt "$bb" ] && [ "$ASK_PX" -lt "$ba" ] \
    || die "the live spread $((ba - bb)) is too tight to quote inside with a half-spread of $half"
  [ $(( ASK_PX - BID_PX )) -le "$MAX_SPREAD" ] || die "derived quotes breach our own envelope"
  ok "quoting bid $BID_PX / ask $ASK_PX (spread $((ASK_PX - BID_PX)), envelope $MAX_SPREAD)"

  # Maker rests both sides inside the live spread. POST_ONLY guarantees it never
  # takes, so the maker cannot accidentally become the taker in its own window.
  bidtx=$(cast send --private-key "$MAKER_PRIVATE_KEY" --rpc-url "$R" --json "$POOL" \
    "placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)" \
    true 0 "$BID_PX" "$QUOTE_QTY" "$expire" 3 0 0x0000000000000000000000000000000000000000 0 \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).transactionHash')
  asktx=$(cast send --private-key "$MAKER_PRIVATE_KEY" --rpc-url "$R" --json "$POOL" \
    "placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)" \
    false 0 "$ASK_PX" "$QUOTE_QTY" "$expire" 3 0 0x0000000000000000000000000000000000000000 0 \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).transactionHash')
  bidid=$(order_id_from "$bidtx"); askid=$(order_id_from "$asktx")
  ok "maker resting bid $BID_PX (order $bidid) and ask $ASK_PX (order $askid)"

  cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" true 1 --rpc-url "$R" | sed 's/^/        best bid /'
  cast call "$POOL" "getBookLevels(bool,uint64)((uint256,uint256)[])" false 1 --rpc-url "$R" | sed 's/^/        best ask /'

  # The taker. This is the transaction that makes the deployer a witnessed
  # trader: it crosses the maker's ask, so OrderFilled names it as takerOrderId.
  taketx=$(cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" --json "$POOL" \
    "placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)" \
    true 0 "$ASK_PX" "$TAKE_QTY" "$expire" 0 0 0x0000000000000000000000000000000000000000 0 \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).transactionHash')
  takeid=$(order_id_from "$taketx")
  ok "deployer took $TAKE_QTY at $ASK_PX as order $takeid, tx $taketx"

  sleep 10   # let the reactive callbacks land
  local vol owner
  vol=$(cast call "$REG" 'witnessedVolume(uint256)(uint256)' 0 --rpc-url "$R" | cut -d' ' -f1)
  owner=$(cast call "$REG" 'orderOwner(uint128)(address)' "$takeid" --rpc-url "$R")
  printf '  ..    witnessedVolume %s, order %s owned by %s\n' "$vol" "$takeid" "$owner"
  [ "$vol" != "0" ] || die "no witnessed volume — the fill was not recorded"
  ok "the fill is witnessed on chain"

  # Now break it. Cancelling both quotes leaves the wider third-party book, whose
  # spread exceeds the committed maximum.
  cast send --private-key "$MAKER_PRIVATE_KEY" --rpc-url "$R" "$POOL" "cancelOrder(uint128)" "$bidid" >/dev/null
  cast send --private-key "$MAKER_PRIVATE_KEY" --rpc-url "$R" "$POOL" "cancelOrder(uint128)" "$askid" >/dev/null
  ok "maker pulled both quotes"

  sleep 10
  local breaches
  breaches=$(cast call "$REG" 'breachCount()(uint256)' --rpc-url "$R" | cut -d' ' -f1)
  [ "$breaches" != "0" ] || die "no breach recorded yet — the book may still be inside the envelope"
  ok "breaches recorded: $breaches"

  { echo "TAKER_ORDER=$takeid"; echo "TAKE_TX=$taketx"; } >> "$STATE"
  say "stage 2 done. Claim once block $END has passed."
  echo "  Next:  ./scripts/p3-live-run.sh claim"
}

# ----------------------------------------------------------------- claim ----
stage_claim() {
  . "$STATE"
  say "P3 stage 3 — claim"
  wait_for_block "$((END + 1))"

  local before after quoted tx
  before=$(cast balance "$DEPLOYER" --rpc-url "$R")
  quoted=$(cast call "$REG" 'claimableFor(uint256,uint128[])(uint256,uint256)' 0 "[$TAKER_ORDER]" --rpc-url "$R")
  printf '  ..    claimable (volume, amount): %s\n' "$quoted"

  tx=$(cast send --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$R" --json "$REG" \
        "claim(uint256,uint128[])(uint256)" 0 "[$TAKER_ORDER]" \
        | node -pe 'JSON.parse(require("fs").readFileSync(0)).transactionHash')
  after=$(cast balance "$DEPLOYER" --rpc-url "$R")
  ok "claim tx $tx"
  printf '  ..    paidOut %s wei\n' "$(cast call "$REG" 'paidOut(uint256)(uint256)' 0 --rpc-url "$R" | cut -d' ' -f1)"
  printf '  ..    registry balance now %s STT\n' "$(cast from-wei "$(cast balance "$REG" --rpc-url "$R")")"
  [ "$after" != "$before" ] || die "the claimant's balance did not change"

  { echo "CLAIM_TX=$tx"; } >> "$STATE"
  say "PAYOUT COMPLETE — §28 item 3 and G5 have their evidence."
  echo "  registry   $REG"
  echo "  claim tx   $tx"
}

case "${1:-}" in
  deploy) stage_deploy ;;
  subscribe)
    . "$STATE"
    say "P3 — funding and subscribing (resume)"
    fund_and_subscribe "$REG" "$SUB" ;;
  trade)  stage_trade  ;;
  claim)  stage_claim  ;;
  *) echo "usage: $0 {deploy|subscribe|trade|claim}" >&2; exit 2 ;;
esac
