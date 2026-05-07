variable "project_name" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "key_name" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "snapshot_id" {
  default     = "snap-0c501f4b4537876be"
  description = "EBS snapshot ID to use as root volume"
  type        = string
}

variable "volume_size" {
  description = "Root EBS volume size — must be >= snapshot size"
  type        = number
}