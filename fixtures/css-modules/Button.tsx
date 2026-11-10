import styles from "./Button.module.css"

export function Button({ children }: { children: string }) {
  return <button className={styles.button}>{children}</button>
}
