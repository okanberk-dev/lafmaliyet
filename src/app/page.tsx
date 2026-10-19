import { redirect } from "next/navigation";

// ladmin.laffogato.net yalnızca yönetim paneli; kafenin sitesi laffogato.net'te.
// Giriş yapılmamışsa /panel isteğini proxy giriş sayfasına yönlendirir.
export default function HomePage() {
  redirect("/panel");
}
