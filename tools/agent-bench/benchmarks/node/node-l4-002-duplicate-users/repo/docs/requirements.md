# Requisitos

## Registro

1. El nombre se guarda sin espacios laterales.
2. Un nombre es duplicado si coincide con otro ignorando mayusculas y espacios laterales; en ese caso se lanza `DuplicateUserError`.
3. Un nombre vacio o solo espacios lanza `Error("invalid name")`.
