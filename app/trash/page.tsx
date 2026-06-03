import { redirect } from 'next/navigation'

// /trash was hernoemd naar /papierbak. Hier blijft een redirect achter
// zodat oude bookmarks + cached navStore-entries (waar nog '/trash' in
// staat) toch goed terechtkomen.
export default function TrashRedirect() {
  redirect('/papierbak')
}
