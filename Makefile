.PHONY: verify gen brand fixtures fuzz

verify:
	node scripts/verify.mjs

gen:
	node scripts/gen-tokens.mjs

brand:
	python scripts/brand/generate_brand_assets.py

fixtures:
	pnpm --filter @antisismo/proto gen:fixtures

fuzz:
	cd services/ingestion && go test -run='^$$' -fuzz=FuzzSanitizePlace -fuzztime=30s ./normalize
	cd services/ingestion && go test -run='^$$' -fuzz=FuzzDecodeEvent -fuzztime=30s ./normalize
