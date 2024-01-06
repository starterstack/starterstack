build-MigrationFunction:
	rm -rf node_modules
	npm install \
		--no-save \
		--audit false \
		--fund false \
		--loglevel=error \
		--ignore-scripts \
		--omit=dev
	cp -r . $(ARTIFACTS_DIR)
	./prune.sh
	cp -r .include-lambda-blob-files $(ARTIFACTS_DIR)
