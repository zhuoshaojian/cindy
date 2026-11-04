# Keep the user's normal interactive shell configuration local to this terminal.
if [ -r "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi

# This is a display label only; never export it to commands or change HOSTNAME.
PS1='\u@cindy:\w\$ '
export -n PS1
