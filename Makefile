.PHONY: test-backend test-frontend test-e2e test-all clean help

.DEFAULT_GOAL := help

## help: Show this help message
help:
	@echo "Available targets:"
	@echo ""
	@grep -E '^##' $(MAKEFILE_LIST) | sed 's/^## /  /'
	@echo ""

## test-backend: Run backend Go tests
test-backend:
	@echo "Running backend tests..."
	go test -v ./...

## test-frontend: Run frontend Jest tests
test-frontend:
	@echo "Running frontend tests..."
	npm test

## test-e2e: Run E2E tests with Playwright
test-e2e:
	@echo "Running E2E tests..."
	npm run test:e2e

## test-all: Run all tests
test-all: test-backend test-frontend test-e2e
	@echo "✅ All tests completed!"

## clean: Remove build artifacts and test outputs
clean:
	@echo "Cleaning..."
	rm -f gdprshare
	rm -rf coverage/
	rm -rf test-results/
	rm -rf playwright-report/
	rm -rf e2e/*.txt
	@echo "✅ Clean complete!"
