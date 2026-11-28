# Installed as /etc/profile.d/cindy-user-tools.sh. /etc/profile resets PATH for login
# shells, and agents run commands in login shells. Put the home's tool directories first
# again, as the image's PATH does for every other process.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH" ;;
esac
export PATH
