# diagrams

## You will need to install

- [Python 3.12](https://www.python.org/downloads/release/python-3121)
- [graphviz](https://graphviz.gitlab.io/download/)

# setup

```sh
pip3 install virtualenv
virtualenv venv
. venv/bin/activate # ./venv/Scripts/activate on windows
pip install -r requirements.txt
```

# create diagrams

```sh
. venv/bin/activate # ./venv/Scripts/activate on windows
while IFS= read -r file; do
  python "${file:?}"
done < <(find . -maxdepth 1 -name "*.py")
```
