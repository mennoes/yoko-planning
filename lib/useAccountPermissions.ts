'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { accountAccessAdmin, type AccountTeamRole } from './accountAccess'
export type AccessUser = { id: string; email: string; role: AccountTeamRole; allowed: boolean; admin: boolean }
async function request(method: string, body?: unknown) {
 const {data}=await supabase!.auth.getSession()
 const response=await fetch('/api/accounts/access',{method,headers:{Authorization:`Bearer ${data.session?.access_token ?? ''}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 const result=await response.json()
 if(!response.ok)throw new Error(result.error || 'Toegang kon niet worden geladen.')
 return result
}
export function useAccountPermissions() {
 const [users,setUsers]=useState<AccessUser[]>([])
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const [canManage,setCanManage]=useState(false)
 const [saving,setSaving]=useState<string|null>(null)
 const refresh=useCallback(async()=>{
  try {
   if(!supabase)return
   const {data,error}=await supabase.auth.getUser()
   if(error)throw new Error('Accountrechten konden niet worden geladen.')
   const admin=accountAccessAdmin(data.user?.app_metadata)
   setCanManage(admin)
   if(!admin){setUsers([]);return}
   const result=await request('GET');setUsers(result.users);setError('')
  }catch(e){setError(e instanceof Error?e.message:'Laden mislukt.')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{
  void refresh()
  const reload=()=>{void refresh()}
  window.addEventListener('focus',reload)
  window.addEventListener('yoko-invite-result',reload)
  return()=>{window.removeEventListener('focus',reload);window.removeEventListener('yoko-invite-result',reload)}
 },[refresh])
 async function save(user:AccessUser) {
  setSaving(user.id);setError('')
  try {await request('PATCH',{userId:user.id,role:user.role,allowed:user.allowed});setUsers(current=>current.map(u=>u.id===user.id?user:u));return true}
  catch(e){setError(e instanceof Error?e.message:'Opslaan mislukt.');return false}
  finally{setSaving(null)}
 }
 return {users,error,loading,canManage,saving,save,refresh}
}
