#!/bin/bash

echo "=================================================================="
echo "Installing git hooks to Lambda repository at \033[1;36m$PWD\033[0m..."
echo "=================================================================="

cp git-hooks/pre-push .git/hooks/
echo "Lambda.................. installed"
