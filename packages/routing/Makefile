SHELL := /bin/sh
PACK_DESTINATION ?= /tmp

.DEFAULT_GOAL := help

.PHONY: help install typecheck test test-shuffled build format-check check pack

help:
	@echo "Routing package commands:"
	@echo "  make install        Install workspace dependencies"
	@echo "  make typecheck      Type-check source and tests"
	@echo "  make test           Run the test suite"
	@echo "  make test-shuffled  Run tests in deterministic shuffled order"
	@echo "  make build          Build JavaScript and declarations"
	@echo "  make format-check   Verify formatting"
	@echo "  make check          Run the complete release gate"
	@echo "  make pack           Build and inspect the publish tarball"

install:
	pnpm install

typecheck:
	pnpm typecheck

test:
	pnpm test

test-shuffled:
	pnpm test -- --sequence.shuffle --sequence.seed=91743

build:
	pnpm build

format-check:
	pnpm dlx prettier@3.6.2 --check --no-semi --print-width 100 --trailing-comma all README.md src test

check: typecheck test-shuffled build format-check

pack: build
	pnpm pack --pack-destination "$(PACK_DESTINATION)"
